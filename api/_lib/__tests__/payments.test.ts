import { HTTPException } from 'hono/http-exception'
import type { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCreditPackCache,
  createCreditCheckout,
  creditPacks,
  processDodoWebhook,
  type DodoEvent,
} from '../payments'

const ORDER_ID = '33333333-3333-4333-8333-333333333333'
// Deliberately not any pack's current allowance: fulfillment must grant the
// amount snapshotted on the order, never the live pack config.
const STORED_CREDITS = 17_321
const DODO = 'https://test.dodopayments.com'
const env = {
  APP_URL: 'https://vibe.test',
  DODO_API_KEY: 'test-key',
  DODO_PRODUCT_CREDITS_SMALL: 'small-product',
  DODO_PRODUCT_CREDITS_MEDIUM: 'medium-product',
  DODO_PRODUCT_CREDITS_LARGE: 'large-product',
}
const event = (
  patch: Partial<NonNullable<DodoEvent['data']>> = {},
): DodoEvent => ({
  type: 'payment.succeeded',
  data: {
    payment_id: 'pay-1',
    status: 'succeeded',
    product_cart: [{ product_id: 'small-product', quantity: 1 }],
    metadata: { kind: 'credit_topup', order_id: ORDER_ID, user_id: 'user-1' },
    ...patch,
  },
})
const reversal = (
  type: string,
  patch: Partial<NonNullable<DodoEvent['data']>> = {},
): DodoEvent => ({
  type,
  data:
    type === 'refund.succeeded'
      ? { payment_id: 'pay-1', refund_id: 're-1', is_partial: false, ...patch }
      : { payment_id: 'pay-1', dispute_id: 'dp-1', ...patch },
})
const price = (amount: number, extra: Record<string, unknown> = {}) =>
  Response.json({
    price: {
      type: 'one_time_price',
      price: amount,
      currency: 'USD',
      ...extra,
    },
  })

type Order = {
  id: string
  user_id: string
  product_id: string
  quantity: number
  credits: number
  payment_id: string | null
  fulfilled_at: Date | null
  reversed_at: Date | null
}
const paidOrder = { payment_id: 'pay-1', fulfilled_at: new Date() }

// Recognizes exactly the statements payments.ts issues and throws on anything
// else, so an unexpected query fails the test instead of silently succeeding.
function fakeDb(
  options: {
    order?: Partial<Order> | null
    duplicateEvent?: boolean
    failLedger?: boolean
    paymentReused?: boolean
    failTracking?: boolean
  } = {},
) {
  const order: Order | null =
    options.order === null
      ? null
      : {
          id: ORDER_ID,
          user_id: 'user-1',
          product_id: 'small-product',
          quantity: 1,
          credits: STORED_CREDITS,
          payment_id: null,
          fulfilled_at: null,
          reversed_at: null,
          ...options.order,
        }
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const ok = (rows: unknown[] = []) => ({ rows, rowCount: rows.length || 1 })
  const query = vi.fn(async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim().toLowerCase()
    calls.push({ sql, params })
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return ok()
    if (sql.startsWith('insert into webhook_events'))
      return { rowCount: options.duplicateEvent ? 0 : 1, rows: [] }
    if (sql.startsWith('insert into credit_purchases'))
      return ok([{ id: ORDER_ID }])
    if (
      sql ===
      'select user_id, product_id, quantity, credits, payment_id, fulfilled_at from credit_purchases where id = $1 for update'
    )
      return order && params[0] === order.id
        ? ok([order])
        : { rows: [], rowCount: 0 }
    if (
      sql ===
      'select id, user_id, credits, reversed_at from credit_purchases where payment_id = $1 for update'
    )
      return order?.payment_id && params[0] === order.payment_id
        ? ok([order])
        : { rows: [], rowCount: 0 }
    if (sql.startsWith('update credit_purchases set payment_id = $2')) {
      if (options.paymentReused)
        throw Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'credit_purchases_payment_id_key',
        })
      return ok()
    }
    if (
      sql.startsWith('update credit_purchases set checkout_session_id = $2') ||
      sql.startsWith('update credit_purchases set checkout_failed_at = now()')
    ) {
      if (options.failTracking) throw new Error('tracking down')
      return ok()
    }
    if (
      sql.startsWith('update credit_purchases set reversed_at = now()') ||
      sql.startsWith(
        'update users set credits_balance = credits_balance + $2',
      ) ||
      sql.startsWith('update users set credits_balance = credits_balance - $2')
    )
      return ok()
    if (sql.startsWith('insert into credit_ledger')) {
      if (options.failLedger) throw new Error('ledger down')
      return ok()
    }
    throw new Error(`Unexpected SQL in fake database: ${sql}`)
  })
  // State changes only; the dedupe insert is part of every delivery.
  const writes = () =>
    calls.filter(
      (call) =>
        /^(insert|update|delete)\b/.test(call.sql) &&
        !call.sql.startsWith('insert into webhook_events'),
    )
  const find = (prefix: string) =>
    calls.find((call) => call.sql.startsWith(prefix))
  return { db: { query } as unknown as Client, calls, writes, find }
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  message: string,
) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(HTTPException)
  expect(error).toMatchObject({ status, message })
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  clearCreditPackCache()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('credit pack catalog', () => {
  it('offers three packs priced from their own encoded Dodo products, including discounts', async () => {
    const prices: Record<string, number> = {
      [`${DODO}/products/small%20pack%2F1`]: 1000,
      [`${DODO}/products/medium%20pack%2F2`]: 2000,
      [`${DODO}/products/large%20pack%2F3`]: 3500,
    }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        price(prices[String(url)], { discount_bps: 1000 }),
      )
    expect(
      await creditPacks({
        DODO_API_KEY: 'test-key',
        DODO_PRODUCT_CREDITS_SMALL: 'small pack/1',
        DODO_PRODUCT_CREDITS_MEDIUM: 'medium pack/2',
        DODO_PRODUCT_CREDITS_LARGE: 'large pack/3',
      }),
    ).toEqual([
      {
        id: 'small',
        credits: 25000,
        available: true,
        price: { amount: 900, currency: 'USD' },
      },
      {
        id: 'medium',
        credits: 50000,
        available: true,
        price: { amount: 1800, currency: 'USD' },
      },
      {
        id: 'large',
        credits: 100000,
        available: true,
        price: { amount: 3150, currency: 'USD' },
      },
    ])
    expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual(
      Object.keys(prices).sort(),
    )
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe('GET')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('keeps the balance page usable and quiet when products are unconfigured', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect((await creditPacks({})).every((pack) => !pack.available)).toBe(true)
    expect(
      (
        await creditPacks({ DODO_PRODUCT_CREDITS_SMALL: 'small-product' })
      ).every((pack) => !pack.available),
    ).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'upstream HTTP failure',
      respond: () => new Response('nope', { status: 404 }),
      expected: { category: 'http', status: 404 },
    },
    {
      name: 'subscription product',
      respond: () =>
        Response.json({
          price: { type: 'recurring_price', price: 1000, currency: 'USD' },
        }),
      expected: { category: 'schema', fields: ['price.type'] },
    },
    {
      name: 'malformed JSON',
      respond: () => new Response('<html>', { status: 200 }),
      // An unparseable body fails validation at the root path.
      expected: { category: 'schema', fields: [''] },
    },
    {
      name: 'pay-what-you-want product',
      respond: () => price(1000, { pay_what_you_want: true }),
      expected: { category: 'pay_what_you_want' },
    },
    {
      name: 'unexpected exception',
      respond: () => {
        throw new TypeError('fetch failed')
      },
      expected: { category: 'exception', error: 'TypeError' },
    },
  ])(
    'logs a $name per configured pack without credentials',
    async ({ respond, expected }) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => respond())
      const packs = await creditPacks(env)
      expect(packs.every((pack) => !pack.available && !pack.price)).toBe(true)
      expect(warn).toHaveBeenCalledTimes(3)
      for (const id of ['small', 'medium', 'large'])
        expect(warn).toHaveBeenCalledWith('dodo credit pack unavailable', {
          pack: id,
          ...expected,
        })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('test-key')
    },
  )

  it('serves polls from the cache once a load settles', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => price(1000))
    const packs = await creditPacks(env)
    expect(await creditPacks(env)).toEqual(packs)
    expect(await creditPacks(env)).toEqual(packs)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('refreshes a healthy catalog after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => price(1000))
    await creditPacks(env)
    vi.setSystemTime(Date.now() + 4 * 60_000)
    await creditPacks(env)
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.setSystemTime(Date.now() + 61_000)
    await creditPacks(env)
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('retries sooner after a transient failure but not after a configuration error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let status = 503
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).endsWith('/small-product')
          ? new Response(null, { status })
          : price(1000),
      )
    await creditPacks(env)
    vi.setSystemTime(Date.now() + 29_000)
    await creditPacks(env)
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.setSystemTime(Date.now() + 2_000)
    status = 404
    expect((await creditPacks(env))[0].available).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(6)
    vi.setSystemTime(Date.now() + 60_000)
    await creditPacks(env)
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('reloads after clearCreditPackCache or a product binding change', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => price(1000))
    await creditPacks(env)
    clearCreditPackCache()
    await creditPacks(env)
    expect(fetch).toHaveBeenCalledTimes(6)
    await creditPacks({ ...env, DODO_PRODUCT_CREDITS_LARGE: 'large-v2' })
    expect(fetch).toHaveBeenCalledTimes(9)
  })
})

describe('credit pack checkout', () => {
  it.each(['small', 'medium', 'large'] as const)(
    'snapshots %s credits before creating checkout and stores the session id',
    async (pack) => {
      const { db, calls, find } = fakeDb()
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url, init) => {
          if (init?.method === 'GET') {
            expect(String(url)).toBe(`${DODO}/products/${pack}-product`)
            return price(2000)
          }
          const body = JSON.parse(String(init?.body))
          expect(body).toMatchObject({
            product_cart: [{ product_id: `${pack}-product`, quantity: 1 }],
            return_url: `https://vibe.test/app/credits?orderId=${ORDER_ID}`,
            metadata: {
              kind: 'credit_topup',
              user_id: 'user-1',
              order_id: ORDER_ID,
            },
          })
          expect(find('insert into credit_purchases')).toBeDefined()
          return Response.json({
            session_id: 'cks_1',
            checkout_url: 'https://checkout.test',
          })
        })
      expect(
        await createCreditCheckout({
          db,
          env,
          pack,
          userId: 'user-1',
          email: 'a@test.com',
        }),
      ).toEqual({ checkoutUrl: 'https://checkout.test' })
      const credits = { small: 25000, medium: 50000, large: 100000 }[pack]
      expect(calls[0].params).toEqual(['user-1', `${pack}-product`, 1, credits])
      expect(
        find('update credit_purchases set checkout_session_id')?.params,
      ).toEqual([ORDER_ID, 'cks_1'])
      expect(find('update credit_purchases set checkout_failed_at')).toBe(
        undefined,
      )
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )

  it('reads the product fresh even when the catalog is cached', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) =>
        init?.method === 'GET'
          ? price(1000)
          : Response.json({ checkout_url: 'https://checkout.test' }),
      )
    await creditPacks(env)
    const { db, find } = fakeDb()
    await createCreditCheckout({
      db,
      env,
      pack: 'small',
      userId: 'user-1',
      email: 'a@test.com',
    })
    expect(fetch).toHaveBeenCalledTimes(5)
    // session_id is optional in Dodo's response.
    expect(find('update credit_purchases set checkout_session_id')).toBe(
      undefined,
    )
  })

  it.each([
    {
      name: 'a subscription product',
      fetch: async () =>
        Response.json({
          price: { type: 'recurring_price', price: 1000, currency: 'USD' },
        }),
    },
    {
      name: 'a lookup timeout',
      fetch: async () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
    },
    {
      name: 'malformed product JSON',
      fetch: async () => new Response('{', { status: 200 }),
    },
    {
      name: 'an upstream error',
      fetch: async () => new Response(null, { status: 500 }),
    },
  ])('returns 503 for $name before creating an order', async ({ fetch }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetch)
    const { db, calls } = fakeDb()
    await expectHttpError(
      createCreditCheckout({
        db,
        env,
        pack: 'small',
        userId: 'user-1',
        email: 'a@test.com',
      }),
      503,
      'This credit pack is currently unavailable',
    )
    expect(calls).toEqual([])
  })

  it.each([
    {
      name: 'rejects the checkout',
      response: () => new Response('bad request', { status: 422 }),
      message: 'Dodo credit checkout failed (422)',
    },
    {
      name: 'returns no checkout URL',
      response: () => Response.json({ session_id: 'cks_1' }),
      message: 'Dodo did not return a checkout URL',
    },
  ])(
    'marks the order failed when Dodo $name',
    async ({ response, message }) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
        init?.method === 'GET' ? price(1000) : response(),
      )
      const { db, find } = fakeDb()
      await expectHttpError(
        createCreditCheckout({
          db,
          env,
          pack: 'small',
          userId: 'user-1',
          email: 'a@test.com',
        }),
        502,
        message,
      )
      expect(
        find('update credit_purchases set checkout_failed_at')?.params,
      ).toEqual([ORDER_ID])
      expect(find('update credit_purchases set checkout_session_id')).toBe(
        undefined,
      )
    },
  )

  it('leaves the order unmarked when the checkout request fails in transport', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'GET') return price(1000)
      throw timeout
    })
    const { db, find } = fakeDb()
    await expect(
      createCreditCheckout({
        db,
        env,
        pack: 'small',
        userId: 'user-1',
        email: 'a@test.com',
      }),
    ).rejects.toBe(timeout)
    expect(find('insert into credit_purchases')).toBeDefined()
    expect(find('update credit_purchases')).toBe(undefined)
  })

  it('never lets a tracking write mask the checkout outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'GET'
        ? price(1000)
        : Response.json({
            session_id: 'cks_1',
            checkout_url: 'https://checkout.test',
          }),
    )
    const { db } = fakeDb({ failTracking: true })
    expect(
      await createCreditCheckout({
        db,
        env,
        pack: 'small',
        userId: 'user-1',
        email: 'a@test.com',
      }),
    ).toEqual({ checkoutUrl: 'https://checkout.test' })
  })
})

describe('credit payment fulfillment', () => {
  it('grants the stored amount and writes the order, balance and ledger in one transaction', async () => {
    const { db, calls, find } = fakeDb()
    const result = await processDodoWebhook(db, env, 'evt-1', event())
    expect(result).toEqual({ status: 'processed', userId: 'user-1' })
    expect(calls[0].sql).toBe('begin')
    expect(calls.at(-1)?.sql).toBe('commit')
    expect(find('update credit_purchases set payment_id')?.params).toEqual([
      ORDER_ID,
      'pay-1',
    ])
    expect(find('update users')?.params).toEqual(['user-1', STORED_CREDITS])
    expect(find('insert into credit_ledger')?.params).toEqual([
      'user-1',
      STORED_CREDITS,
      ORDER_ID,
      JSON.stringify({ paymentId: 'pay-1' }),
    ])
  })

  it.each([{ duplicateEvent: true }, { order: paidOrder }])(
    'deduplicates event or order independently: %j',
    async (options) => {
      const { db, writes } = fakeDb(options)
      expect(
        await processDodoWebhook(db, env, 'another-event', event()),
      ).toEqual({ status: 'deduped' })
      expect(writes()).toEqual([])
    },
  )

  it.each([
    {
      name: 'an unknown order',
      options: { order: null },
      patch: {},
      message: 'Unknown credit order',
    },
    {
      name: 'a different payment for a paid order',
      options: { order: paidOrder },
      patch: { payment_id: 'pay-2' },
      message: 'Credit order already paid',
    },
    {
      name: 'a payment already used by another order',
      options: { paymentReused: true },
      patch: {},
      message: 'Credit payment already used',
    },
    {
      name: 'the wrong product',
      patch: { product_cart: [{ product_id: 'wrong-product', quantity: 1 }] },
      message: 'Credit payment does not match its order',
    },
    {
      name: 'the wrong quantity',
      patch: { product_cart: [{ product_id: 'small-product', quantity: 2 }] },
      message: 'Credit payment does not match its order',
    },
    {
      name: 'another user',
      patch: {
        metadata: {
          kind: 'credit_topup',
          order_id: ORDER_ID,
          user_id: 'someone-else',
        },
      },
      message: 'Credit payment does not match its order',
    },
    {
      name: 'a missing cart',
      patch: { product_cart: null },
      message: 'Credit payment does not match its order',
    },
    {
      name: 'a failed status',
      patch: { status: 'failed' },
      message: 'Invalid credit payment',
    },
    {
      name: 'a subscription payment',
      patch: { subscription_id: 'sub-1' },
      message: 'Invalid credit payment',
    },
    {
      name: 'a missing payment id',
      patch: { payment_id: undefined },
      message: 'Invalid credit payment',
    },
    {
      name: 'a malformed order id',
      patch: {
        metadata: { kind: 'credit_topup', order_id: 'x', user_id: 'user-1' },
      },
      message: 'Invalid credit payment',
    },
  ])(
    'rejects $name with 400 and rolls back',
    async ({ options, patch, message }) => {
      const { db, calls, find } = fakeDb(options)
      await expectHttpError(
        processDodoWebhook(db, env, 'evt-1', event(patch)),
        400,
        message,
      )
      expect(calls.at(-1)?.sql).toBe('rollback')
      expect(calls.some((call) => call.sql === 'commit')).toBe(false)
      expect(find('update users')).toBe(undefined)
      expect(find('insert into credit_ledger')).toBe(undefined)
    },
  )

  it('rolls back the dedupe record and fulfillment if the ledger fails', async () => {
    const { db, calls } = fakeDb({ failLedger: true })
    await expect(processDodoWebhook(db, env, 'evt-1', event())).rejects.toThrow(
      'ledger down',
    )
    expect(calls.at(-1)?.sql).toBe('rollback')
    expect(calls.some((call) => call.sql === 'commit')).toBe(false)
  })

  it('ignores unrelated subscription payments', async () => {
    const { db, writes } = fakeDb()
    expect(
      await processDodoWebhook(
        db,
        env,
        'evt-1',
        event({ metadata: { plan: 'pro' } }),
      ),
    ).toEqual({ status: 'ignored' })
    expect(writes()).toEqual([])
  })
})

describe('credit purchase reversal', () => {
  it.each([
    {
      type: 'refund.succeeded',
      reason: 'refund',
      metadata: { paymentId: 'pay-1', refundId: 're-1' },
    },
    {
      type: 'dispute.lost',
      reason: 'dispute',
      metadata: { paymentId: 'pay-1', disputeId: 'dp-1' },
    },
    {
      type: 'dispute.accepted',
      reason: 'dispute',
      metadata: { paymentId: 'pay-1', disputeId: 'dp-1' },
    },
  ])(
    'reverses the whole stored grant on $type',
    async ({ type, reason, metadata }) => {
      const { db, calls, find } = fakeDb({ order: paidOrder })
      expect(
        await processDodoWebhook(db, env, 'evt-r', reversal(type)),
      ).toEqual({ status: 'processed', userId: 'user-1' })
      expect(calls[0].sql).toBe('begin')
      expect(calls.at(-1)?.sql).toBe('commit')
      expect(
        find('select id, user_id, credits, reversed_at from credit_purchases')
          ?.params,
      ).toEqual(['pay-1'])
      expect(find('update credit_purchases set reversed_at')?.params).toEqual([
        ORDER_ID,
        metadata.refundId ?? metadata.disputeId,
        reason,
      ])
      expect(
        find('update users set credits_balance = credits_balance - $2')?.params,
      ).toEqual(['user-1', STORED_CREDITS])
      expect(find('insert into credit_ledger')?.params).toEqual([
        'user-1',
        -STORED_CREDITS,
        ORDER_ID,
        JSON.stringify(metadata),
      ])
      expect(find('insert into credit_ledger')?.sql).toContain(
        "'reversal.purchase'",
      )
    },
  )

  it('dedupes a second reversal of the same order', async () => {
    const { db, writes } = fakeDb({
      order: { ...paidOrder, reversed_at: new Date() },
    })
    expect(
      await processDodoWebhook(db, env, 'evt-r2', reversal('dispute.lost')),
    ).toEqual({ status: 'deduped' })
    expect(writes()).toEqual([])
  })

  it.each([true, null, undefined])(
    'leaves a refund with is_partial=%s for manual adjustment',
    async (isPartial) => {
      const { db, calls, writes } = fakeDb({ order: paidOrder })
      expect(
        await processDodoWebhook(
          db,
          env,
          'evt-r',
          reversal('refund.succeeded', { is_partial: isPartial }),
        ),
      ).toEqual({ status: 'ignored' })
      expect(writes()).toEqual([])
      expect(calls.at(-1)?.sql).toBe('commit')
      expect(warn).toHaveBeenCalledWith(
        'dodo webhook: partial credit refund needs manual adjustment',
        { orderId: ORDER_ID, refundId: 're-1', paymentId: 'pay-1' },
      )
    },
  )

  it.each([
    { name: 'an unknown payment', patch: { payment_id: 'subscription-pay' } },
    { name: 'no payment id', patch: { payment_id: undefined } },
  ])('ignores a refund for $name', async ({ patch }) => {
    const { db, writes } = fakeDb({ order: paidOrder })
    expect(
      await processDodoWebhook(
        db,
        env,
        'evt-r',
        reversal('refund.succeeded', patch),
      ),
    ).toEqual({ status: 'ignored' })
    expect(writes()).toEqual([])
  })

  it('ignores a refund that arrives before its payment was fulfilled', async () => {
    const { db, writes } = fakeDb()
    expect(
      await processDodoWebhook(db, env, 'evt-r', reversal('refund.succeeded')),
    ).toEqual({ status: 'ignored' })
    expect(writes()).toEqual([])
  })

  it('rejects a reversal without its refund id', async () => {
    const { db, calls } = fakeDb({ order: paidOrder })
    await expectHttpError(
      processDodoWebhook(
        db,
        env,
        'evt-r',
        reversal('refund.succeeded', { refund_id: null }),
      ),
      400,
      'Invalid credit reversal',
    )
    expect(calls.at(-1)?.sql).toBe('rollback')
  })

  it('rolls back the reversal and its dedupe record if the ledger fails', async () => {
    const { db, calls } = fakeDb({ order: paidOrder, failLedger: true })
    await expect(
      processDodoWebhook(db, env, 'evt-r', reversal('refund.succeeded')),
    ).rejects.toThrow('ledger down')
    expect(calls.at(-1)?.sql).toBe('rollback')
    expect(calls.some((call) => call.sql === 'commit')).toBe(false)
  })
})
