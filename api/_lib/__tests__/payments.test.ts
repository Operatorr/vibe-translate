import type { Client } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCreditCheckout,
  creditPacks,
  processDodoWebhook,
  type DodoEvent,
} from '../payments'

const ORDER = '33333333-3333-4333-8333-333333333333'
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
    metadata: { kind: 'credit_topup', order_id: ORDER, user_id: 'user-1' },
    ...patch,
  },
})
function fakeDb(
  options: {
    fulfilled?: boolean
    duplicateEvent?: boolean
    failLedger?: boolean
  } = {},
) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const query = vi.fn(async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim().toLowerCase()
    calls.push({ sql, params })
    if (sql.startsWith('insert into webhook_events'))
      return { rowCount: options.duplicateEvent ? 0 : 1, rows: [] }
    if (sql.startsWith('insert into credit_purchases'))
      return { rowCount: 1, rows: [{ id: ORDER }] }
    if (sql.includes('from credit_purchases'))
      return {
        rows: [
          {
            user_id: 'user-1',
            product_id: 'small-product',
            quantity: 1,
            credits: 25000,
            payment_id: options.fulfilled ? 'pay-1' : null,
            fulfilled_at: options.fulfilled ? new Date() : null,
          },
        ],
        rowCount: 1,
      }
    if (sql.startsWith('insert into credit_ledger') && options.failLedger)
      throw new Error('ledger down')
    return { rows: [], rowCount: 1 }
  })
  return { db: { query } as unknown as Client, calls }
}
afterEach(() => vi.restoreAllMocks())

describe('credit pack checkout', () => {
  it('offers three packs with prices fetched from Dodo, including discounts', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        price: {
          type: 'one_time_price',
          price: 1000,
          currency: 'USD',
          discount_bps: 1000,
        },
      }),
    )
    expect(await creditPacks(env)).toEqual(
      ['small', 'medium', 'large'].map((id, index) => ({
        id,
        credits: [25000, 50000, 100000][index],
        available: true,
        price: { amount: 900, currency: 'USD' },
      })),
    )
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('keeps the balance page usable when payment products are absent or unavailable', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline'))
    expect((await creditPacks({})).every((pack) => !pack.available)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect((await creditPacks(env)).every((pack) => !pack.available)).toBe(true)
  })
  it.each(['small', 'medium', 'large'] as const)(
    'snapshots %s credits before creating checkout',
    async (pack) => {
      const { db, calls } = fakeDb()
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => {
          if (init?.method === 'GET')
            return Response.json({
              price: { type: 'one_time_price', price: 2000, currency: 'USD' },
            })
          const body = JSON.parse(String(init?.body))
          expect(body).toMatchObject({
            product_cart: [{ product_id: `${pack}-product`, quantity: 1 }],
            return_url: `https://vibe.test/app/credits?orderId=${ORDER}`,
            metadata: {
              kind: 'credit_topup',
              user_id: 'user-1',
              order_id: ORDER,
            },
          })
          expect(
            calls.some((call) =>
              call.sql.startsWith('insert into credit_purchases'),
            ),
          ).toBe(true)
          return Response.json({ checkout_url: 'https://checkout.test' })
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
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )
  it('rejects subscription products used as top-ups before creating an order', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        price: { type: 'recurring_price', price: 1000, currency: 'USD' },
      }),
    )
    const { db, calls } = fakeDb()
    await expect(
      createCreditCheckout({
        db,
        env,
        pack: 'small',
        userId: 'user-1',
        email: 'a@test.com',
      }),
    ).rejects.toThrow('not available')
    expect(calls).toEqual([])
  })
})

describe('credit payment fulfillment', () => {
  it('grants the stored amount and writes the order, balance and ledger in one transaction', async () => {
    const { db, calls } = fakeDb()
    const result = await processDodoWebhook(db, env, 'evt-1', event())
    expect(result).toEqual({ status: 'processed', userId: 'user-1' })
    expect(calls[0].sql).toBe('begin')
    expect(calls.at(-1)?.sql).toBe('commit')
    expect(
      calls.find((call) => call.sql.startsWith('update users'))?.params,
    ).toEqual(['user-1', 25000])
    expect(
      calls
        .find((call) => call.sql.startsWith('insert into credit_ledger'))
        ?.params.slice(0, 3),
    ).toEqual(['user-1', 25000, ORDER])
  })
  it.each([{ duplicateEvent: true }, { fulfilled: true }])(
    'deduplicates event or order independently: %j',
    async (options) => {
      const { db, calls } = fakeDb(options)
      expect(
        await processDodoWebhook(db, env, 'another-event', event()),
      ).toEqual({ status: 'deduped' })
      expect(calls.some((call) => call.sql.startsWith('update users'))).toBe(
        false,
      )
    },
  )
  it.each([
    { product_cart: [{ product_id: 'wrong-product', quantity: 1 }] },
    { product_cart: [{ product_id: 'small-product', quantity: 2 }] },
    {
      metadata: {
        kind: 'credit_topup',
        order_id: ORDER,
        user_id: 'someone-else',
      },
    },
    { status: 'failed' },
    { subscription_id: 'sub-1' },
    { product_cart: null },
  ])('rejects a payment that does not match its order: %j', async (patch) => {
    const { db, calls } = fakeDb()
    await expect(
      processDodoWebhook(db, env, 'evt-1', event(patch)),
    ).rejects.toThrow()
    expect(calls.at(-1)?.sql).toBe('rollback')
    expect(calls.some((call) => call.sql.startsWith('update users'))).toBe(
      false,
    )
  })
  it('rolls back the dedupe record and fulfillment if the ledger fails', async () => {
    const { db, calls } = fakeDb({ failLedger: true })
    await expect(processDodoWebhook(db, env, 'evt-1', event())).rejects.toThrow(
      'ledger down',
    )
    expect(calls.at(-1)?.sql).toBe('rollback')
    expect(calls.some((call) => call.sql === 'commit')).toBe(false)
  })
  it('ignores unrelated subscription payments', async () => {
    const { db, calls } = fakeDb()
    expect(
      await processDodoWebhook(
        db,
        env,
        'evt-1',
        event({ metadata: { plan: 'pro' } }),
      ),
    ).toEqual({ status: 'ignored' })
    expect(calls.some((call) => call.sql.startsWith('update users'))).toBe(
      false,
    )
  })
})
