import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level tests for the share capability and the credit ordering around
// translate/retry. Every I/O module is mocked; the fake pg client answers by
// SQL substring, so each test scripts exactly the rows its path needs.

type Row = Record<string, unknown>
type Answer = { rows: Row[]; rowCount?: number } | Error
let answer: (sql: string, params: unknown[]) => Answer
const queries: string[] = []

const fakeDb = {
  connect: vi.fn(async () => undefined),
  end: vi.fn(async () => undefined),
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    queries.push(norm)
    const result = answer(norm, params)
    if (result instanceof Error) throw result
    return { rowCount: result.rows.length, ...result }
  }),
}

vi.mock('../_lib/auth', () => ({
  authBaseURL: (env: { APP_URL?: string }) =>
    env.APP_URL ?? 'http://localhost:5173',
  authHandler: vi.fn(),
  auth:
    () =>
    async (
      c: { set: (k: string, v: string) => void },
      next: () => Promise<void>,
    ) => {
      c.set('userId', 'user_1')
      c.set('email', 'a@example.com')
      await next()
    },
}))
vi.mock('../_lib/db', () => ({
  withDb: (_env: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
  createDbClient: () => fakeDb,
}))
// findUser stays real so the credit-history snapshot read reaches the fake db.
vi.mock('../_lib/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/users')>()),
  getOrCreateUser: vi.fn(async () => ({
    tier: 'pro',
    onboardingComplete: true,
  })),
  toMeResponse: vi.fn(),
}))
vi.mock('../_lib/activity', () => ({
  logActivity: vi.fn(async () => undefined),
}))
vi.mock('../_lib/openrouter', () => ({
  resolveCallTarget: vi.fn(async () => ({
    isByok: false,
    apiKey: 'k',
    modelId: 'test/model',
    creditCostMultiplier: 1,
    reasoning: undefined,
  })),
}))
vi.mock('../_lib/ai', () => ({
  translateSegment: vi.fn(async () => ({
    targetText: 'やあ',
    tokenAlignment: [{ t: 'やあ', src: 'hi' }],
    tokenUsage: { modelId: 'test/model', promptTokens: 5, completionTokens: 3 },
  })),
  draftCharacterFromDictation: vi.fn(),
}))
vi.mock('../_lib/credits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/credits')>()),
  reserveCredits: vi.fn(async () => ({ ledgerId: 'ledger_1', reserved: 5 })),
  reconcileSpend: vi.fn(async () => undefined),
  refundReservation: vi.fn(async () => undefined),
}))
vi.mock('../_lib/embeddings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/embeddings')>()),
  embedText: vi.fn(async () => ({ vector: [0.1, 0.2] })),
}))
vi.mock('../_lib/translation-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/translation-cache')>()),
  lookupCache: vi.fn(async () => null),
  upsertCache: vi.fn(async () => undefined),
}))

const { default: app } = await import('../app')
const credits = await import('../_lib/credits')
const cache = await import('../_lib/translation-cache')
const { clearCreditPackCache } = await import('../_lib/payments')

const env = { APP_URL: 'https://vibe.test' }
const THREAD = '11111111-1111-4111-8111-111111111111'
const SEGMENT = '22222222-2222-4222-8222-222222222222'

const segmentRow = (targetText = 'やあ') => ({
  id: SEGMENT,
  thread_id: THREAD,
  source_text: 'hi',
  target_text: targetText,
  vibe: 'casual',
  token_alignment: [],
  token_usage: {},
  created_at: '2026-09-14T10:00:00.000Z',
  updated_at: '2026-09-14T10:00:00.000Z',
})

const call = (path: string, init?: RequestInit) => app.request(path, init, env)
const postJson = (path: string, body: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  clearCreditPackCache()
  queries.length = 0
  answer = () => ({ rows: [] })
})

describe('share links', () => {
  const ownThread = (sql: string): Answer | null =>
    sql.startsWith('select user_id, archived_at from threads')
      ? { rows: [{ user_id: 'user_1', archived_at: null }] }
      : null

  it('mints through the live-link unique index and answers 201', async () => {
    answer = (sql) =>
      ownThread(sql) ??
      (sql.startsWith('insert into thread_shares')
        ? { rows: [{ token: 'NEWTOKEN' }] }
        : { rows: [] })
    const res = await call(`/api/threads/${THREAD}/share`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      shared: true,
      token: 'NEWTOKEN',
      url: 'https://vibe.test/share/NEWTOKEN',
    })
    expect(
      queries.some((q) =>
        q.includes(
          'on conflict (thread_id) where revoked_at is null do nothing',
        ),
      ),
    ).toBe(true)
  })

  it('returns the existing live token with 200 when a mint loses the race', async () => {
    answer = (sql) =>
      ownThread(sql) ??
      (sql.startsWith('insert into thread_shares')
        ? { rows: [] }
        : sql.startsWith('select token from thread_shares')
          ? { rows: [{ token: 'WINNER' }] }
          : { rows: [] })
    const res = await call(`/api/threads/${THREAD}/share`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { token: string }).token).toBe('WINNER')
  })

  it('refuses to share an archived thread', async () => {
    answer = (sql) =>
      sql.startsWith('select user_id, archived_at from threads')
        ? {
            rows: [
              { user_id: 'user_1', archived_at: '2026-09-01T00:00:00.000Z' },
            ],
          }
        : { rows: [] }
    const res = await call(`/api/threads/${THREAD}/share`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(queries.some((q) => q.startsWith('insert into thread_shares'))).toBe(
      false,
    )
  })

  it('sends no-store and noindex on public error responses too', async () => {
    const res = await call('/api/share/not a token')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('treats a malformed thread id as 404 without touching the database', async () => {
    const res = await call('/api/threads/not-a-uuid/share')
    expect(res.status).toBe(404)
    expect(queries).toHaveLength(0)
  })

  it('does not relabel an unknown historical vibe with the current default', async () => {
    answer = (sql) => {
      if (sql.includes('from thread_shares sh'))
        return {
          rows: [
            {
              thread_id: THREAD,
              title: 'History',
              created_at: '2026-09-14T10:00:00Z',
              updated_at: '2026-09-14T10:00:00Z',
              name: 'Character',
              source_language: 'en-US',
              target_language: 'ja-JP',
              default_vibe: 'emperor',
            },
          ],
        }
      if (sql.includes('from segments where thread_id'))
        return {
          rows: [
            { ...segmentRow(), vibe: null },
            { ...segmentRow(), id: 'known', vibe: 'casual' },
          ],
        }
      return { rows: [] }
    }
    const res = await call('/api/share/abcdefghijklmnop')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      character: { defaultVibe: 'emperor' },
      segments: [{ vibe: null }, { vibe: 'casual' }],
    })
  })
})

describe('translate credit ordering', () => {
  const createAnswers = (
    sql: string,
    overrides: Partial<Record<'insert', Answer>> = {},
  ): Answer => {
    if (sql.startsWith('select t.user_id, c.source_language')) {
      return {
        rows: [
          {
            user_id: 'user_1',
            source_language: 'en-US',
            target_language: 'ja-JP',
            default_vibe: 'casual',
            temperature: '0.4',
            persona: { traits: [] },
            instructions: null,
          },
        ],
      }
    }
    if (sql.includes('vibe is not distinct from')) return { rows: [] } // no dedupe hit
    if (sql.startsWith('insert into segments'))
      return overrides.insert ?? { rows: [segmentRow()] }
    return { rows: [] }
  }

  it('returns an in-thread duplicate as 200 reused without charging', async () => {
    answer = (sql) =>
      sql.includes('vibe is not distinct from')
        ? { rows: [segmentRow()] }
        : createAnswers(sql)
    const res = await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: SEGMENT, reused: true })
    expect(queries.some((q) => q.startsWith('insert into segments'))).toBe(
      false,
    )
    expect(credits.reserveCredits).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'marks an inserted Segment as 201 not reused (cache hit: %s)',
    async (cached) => {
      if (cached)
        vi.mocked(cache.lookupCache).mockResolvedValueOnce({
          targetText: 'やあ',
          tokenAlignment: [],
          sourceEmbedding: null,
        })
      answer = (sql) => createAnswers(sql)
      const res = await postJson('/api/segments', {
        threadId: THREAD,
        sourceText: 'hi',
        vibe: 'casual',
      })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ id: SEGMENT, reused: false })
      expect(
        queries.filter((q) => q.startsWith('insert into segments')),
      ).toHaveLength(1)
    },
  )

  it('charges and keeps the Segment when a post-insert step fails', async () => {
    vi.mocked(cache.upsertCache).mockRejectedValueOnce(new Error('cache down'))
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    answer = (sql) => createAnswers(sql)
    const res = await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    expect(res.status).toBe(201)
    expect(credits.reconcileSpend).toHaveBeenCalledTimes(1)
    expect(credits.reconcileSpend).toHaveBeenCalledWith(
      fakeDb,
      'user_1',
      { ledgerId: 'ledger_1', reserved: 5 },
      {
        credits: 8,
        promptTokens: 5,
        completionTokens: 3,
        modelId: 'test/model',
      },
      SEGMENT,
    )
    expect(credits.refundReservation).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  // 5 prompt + 3 completion tokens from the translateSegment mock.
  it.each([
    { label: 'platform at 1x', isByok: false, multiplier: 1, charged: 8 },
    { label: 'platform at 2x', isByok: false, multiplier: 2, charged: 16 },
    { label: 'BYOK', isByok: true, multiplier: 2, charged: 0 },
  ])(
    'persists the same credit charge that settlement applies ($label)',
    async ({ isByok, multiplier, charged }) => {
      const openrouter = await import('../_lib/openrouter')
      vi.mocked(openrouter.resolveCallTarget).mockResolvedValueOnce({
        isByok,
        apiKey: 'k',
        modelId: 'test/model',
        modelRowId: null,
        creditCostMultiplier: multiplier,
        reasoning: undefined,
      })
      let usage: { creditsCharged?: unknown } | undefined
      answer = (sql, params) => {
        if (sql.startsWith('insert into segments'))
          usage = JSON.parse(params[6] as string)
        return createAnswers(sql)
      }
      const res = await postJson('/api/segments', {
        threadId: THREAD,
        sourceText: 'hi',
        vibe: 'casual',
      })
      expect(res.status).toBe(201)
      expect(usage).toMatchObject({
        promptTokens: 5,
        completionTokens: 3,
        creditsCharged: charged,
      })
      if (isByok) {
        expect(credits.reserveCredits).not.toHaveBeenCalled()
        expect(credits.reconcileSpend).not.toHaveBeenCalled()
        return
      }
      expect(credits.reconcileSpend).toHaveBeenCalledTimes(1)
      const [, , , cost] = vi.mocked(credits.reconcileSpend).mock.calls[0]
      expect(usage?.creditsCharged).toBe(cost.credits)
    },
  )

  it('reports the remaining balance and required hold when a translation is rejected', async () => {
    vi.mocked(credits.reserveCredits).mockResolvedValueOnce(null)
    answer = (sql) =>
      sql.startsWith('select credits_balance')
        ? { rows: [{ credits_balance: 198 }] }
        : createAnswers(sql)
    const res = await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      error: {
        details: {
          code: 'insufficient_credits',
          balance: 198,
          requiredCredits: 402,
        },
      },
    })
    const ai = await import('../_lib/ai')
    expect(ai.translateSegment).not.toHaveBeenCalled()
    expect(queries.some((q) => q.startsWith('insert into segments'))).toBe(
      false,
    )
    expect(credits.reconcileSpend).not.toHaveBeenCalled()
    expect(credits.refundReservation).not.toHaveBeenCalled()
  })

  it('refunds when the Segment insert itself fails', async () => {
    answer = (sql) => createAnswers(sql, { insert: new Error('insert failed') })
    const res = await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    expect(res.status).toBe(500)
    expect(credits.refundReservation).toHaveBeenCalledTimes(1)
    expect(credits.reconcileSpend).not.toHaveBeenCalled()
  })

  it('marks a shared-cache hit as cached', async () => {
    vi.mocked(cache.lookupCache).mockResolvedValueOnce({
      targetText: 'やあ',
      tokenAlignment: [],
      sourceEmbedding: null,
    })
    answer = (sql) => createAnswers(sql)
    await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    const insert = fakeDb.query.mock.calls.find(([sql]) =>
      String(sql).includes('insert into segments'),
    )
    expect(insert?.[1]?.[6]).toBe(JSON.stringify({ cached: true }))
    expect(credits.reserveCredits).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'snapshots an omitted vibe on create (cache hit: %s)',
    async (cached) => {
      if (cached)
        vi.mocked(cache.lookupCache).mockResolvedValueOnce({
          targetText: 'やあ',
          tokenAlignment: [],
          sourceEmbedding: null,
        })
      answer = (sql) => createAnswers(sql)
      const res = await postJson('/api/segments', {
        threadId: THREAD,
        sourceText: 'hi',
      })
      expect(res.status).toBe(201)
      const insert = fakeDb.query.mock.calls.find(([sql]) =>
        String(sql).includes('insert into segments'),
      )
      expect(insert?.[1]?.[4]).toBe('casual')
      const dedupe = fakeDb.query.mock.calls.find(([sql]) =>
        String(sql).includes('vibe is not distinct from'),
      )
      expect(dedupe?.[1]?.[2]).toBe('casual')
    },
  )

  it.each(['friend', null])(
    'retry persists the actual vibe used (stored vibe: %s)',
    async (stored) => {
      answer = (sql, params) => {
        if (sql.startsWith('select s.id, s.thread_id'))
          return {
            rows: [
              {
                ...segmentRow('old'),
                vibe: stored,
                user_id: 'user_1',
                source_language: 'en-US',
                target_language: 'ja-JP',
                temperature: '0.4',
                persona: { traits: [] },
                instructions: null,
                default_vibe: 'emperor',
              },
            ],
          }
        if (sql.startsWith('with updated as'))
          return { rows: [{ ...segmentRow(), vibe: params[5] }] }
        return { rows: [] }
      }
      const res = await call(`/api/segments/${SEGMENT}/retry`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ vibe: stored ?? 'emperor' })
      const update = fakeDb.query.mock.calls.find(([sql]) =>
        String(sql).includes('with updated as'),
      )
      expect(update?.[0]).toContain('vibe = $6')
      expect(update?.[1]?.[5]).toBe(stored ?? 'emperor')
    },
  )

  it('logs and does not swallow a failed refund', async () => {
    const ai = await import('../_lib/ai')
    vi.mocked(ai.translateSegment).mockRejectedValueOnce(
      new Error('model down'),
    )
    vi.mocked(credits.refundReservation).mockRejectedValueOnce(
      new Error('refund failed'),
    )
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    answer = (sql) => createAnswers(sql)
    const res = await postJson('/api/segments', {
      threadId: THREAD,
      sourceText: 'hi',
      vibe: 'casual',
    })
    expect(res.status).toBe(500)
    expect(errors).toHaveBeenCalledWith(
      'credit refund failed',
      expect.objectContaining({ ledgerId: 'ledger_1' }),
    )
    errors.mockRestore()
  })

  it('retry refunds and 404s when the Segment vanished mid-flight', async () => {
    answer = (sql) => {
      if (sql.startsWith('select s.id, s.thread_id')) {
        return {
          rows: [
            {
              ...segmentRow('old'),
              user_id: 'user_1',
              source_language: 'en-US',
              target_language: 'ja-JP',
              temperature: '0.4',
              persona: { traits: [] },
              instructions: null,
              default_vibe: 'casual',
            },
          ],
        }
      }
      if (sql.startsWith('with updated as')) return { rows: [] }
      return { rows: [] }
    }
    const res = await call(`/api/segments/${SEGMENT}/retry`, { method: 'POST' })
    expect(res.status).toBe(404)
    expect(credits.refundReservation).toHaveBeenCalledTimes(1)
    expect(credits.reconcileSpend).not.toHaveBeenCalled()
    const update = queries.find((q) => q.startsWith('with updated as'))
    expect(update).toContain('where id = $1 and user_id = $5')
  })
})

describe('checkout-first profile provisioning', () => {
  it('provisions the email and signup grant before checkout, then sends activation mail', async () => {
    const users = await import('../_lib/users')
    const actualUsers =
      await vi.importActual<typeof import('../_lib/users')>('../_lib/users')
    vi.mocked(users.getOrCreateUser).mockImplementationOnce(
      actualUsers.getOrCreateUser,
    )
    let profile: Row | null = null
    answer = (sql, params) => {
      if (sql.startsWith('with inserted as')) {
        profile = {
          auth_user_id: params[0],
          email: params[1],
          tier: 'free',
          credits_balance: params[2],
        }
        return { rows: [profile] }
      }
      if (sql.startsWith('insert into users (auth_user_id)')) {
        profile ??= { auth_user_id: params[0], email: null }
        return { rows: [] }
      }
      if (sql.startsWith('select email from users'))
        return { rows: profile ? [profile] : [] }
      if (sql.startsWith('insert into webhook_events'))
        return { rows: [], rowCount: 1 }
      return { rows: [] }
    }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        if (String(input).endsWith('/checkouts')) {
          expect(profile).toMatchObject({
            auth_user_id: 'user_1',
            email: 'a@example.com',
          })
          expect(
            queries.some((sql) => sql.includes('insert into credit_ledger')),
          ).toBe(true)
          return Response.json({
            checkout_url: 'https://checkout.test/session',
          })
        }
        expect(String(input)).toBe('https://api.resend.com/emails')
        expect(JSON.parse(String(options?.body))).toMatchObject({
          to: 'a@example.com',
          subject: 'Your Vibe Translate Pro plan is active',
        })
        return Response.json({ id: 'mail' })
      })
    const billingEnv = {
      ...env,
      DODO_PRODUCT_PRO: 'prod-pro',
      DODO_API_KEY: 'test-key',
      DODO_WEBHOOK_SECRET: btoa('test-signing-key'),
      RESEND_API_KEY: 'test-email-key',
    }
    const checkout = await app.request(
      '/api/billing/checkout',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'pro', billingPeriod: 'monthly' }),
      },
      billingEnv,
    )
    expect(checkout.status).toBe(200)
    const raw = JSON.stringify({
      type: 'subscription.active',
      data: {
        subscription_id: 'sub-1',
        metadata: { user_id: 'user_1', plan: 'pro' },
      },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('test-signing-key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`evt-1.${timestamp}.${raw}`),
    )
    const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    const webhook = await app.request(
      '/api/billing/webhooks/dodo',
      {
        method: 'POST',
        headers: {
          'webhook-id': 'evt-1',
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${encoded}`,
        },
        body: raw,
      },
      billingEnv,
    )
    expect(webhook.status).toBe(200)
    expect(await webhook.json()).toEqual({ ok: true, status: 'processed' })
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockRestore()
  })
})

// Deterministic UUIDs that sort in creation order, so the fake page query can
// order them as PostgreSQL would.
const uuidFor = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const CHARACTER = uuidFor(0xc0ffee)

// `total` Segments in creation order. Pairs share a microsecond so the UUID
// tie-breaker matters, and the cursor text keeps all six fractional digits.
const history = (total: number) =>
  Array.from({ length: total }, (_, i) => {
    const micros = String(Math.floor((i + 1) / 2)).padStart(6, '0')
    const createdAt = `2026-09-14T10:00:00.${micros}Z`
    return {
      ...segmentRow(),
      id: uuidFor(i + 1),
      created_at: createdAt,
      cursor_created_at: createdAt,
    }
  })
type HistoryRow = ReturnType<typeof history>[number]

// Answers like PostgreSQL: strict `(created_at, id)` cursor, newest first,
// with the LIMIT taken from the route's own SQL.
const newestFirst = (rows: HistoryRow[], sql: string, params: unknown[]) => {
  const limit = Number(/created_at desc, id desc limit (\d+)/.exec(sql)?.[1])
  const [, , beforeCreatedAt, beforeId] = params as string[]
  return rows
    .filter(
      (r) =>
        beforeId === undefined ||
        r.cursor_created_at < beforeCreatedAt ||
        (r.cursor_created_at === beforeCreatedAt && r.id < beforeId),
    )
    .reverse()
    .slice(0, limit)
}
const pageAnswer =
  (rows: HistoryRow[]) =>
  (sql: string, params: unknown[]): Answer =>
    sql.includes('from segments where user_id = $1 and thread_id = $2')
      ? { rows: newestFirst(rows, sql, params) }
      : { rows: [] }

type Page = {
  segments: { id: string }[]
  nextCursor: { createdAt: string; id: string } | null
}
const pagePath = (cursor?: Page['nextCursor']) =>
  `/api/segments/page?threadId=${THREAD}` +
  (cursor
    ? `&beforeCreatedAt=${encodeURIComponent(cursor.createdAt)}&beforeId=${cursor.id}`
    : '')

// Follows nextCursor from `first` until exhausted; returns pages oldest first.
async function drain(first: Page) {
  const pages = [first]
  for (let page = first; page.nextCursor; ) {
    const cursor = page.nextCursor
    const res = await call(pagePath(cursor))
    expect(res.status).toBe(200)
    // The cursor goes back to the database exactly as the server emitted it.
    expect(fakeDb.query).toHaveBeenLastCalledWith(
      expect.stringContaining('(created_at, id) < ($3::timestamptz, $4::uuid)'),
      ['user_1', THREAD, cursor.createdAt, cursor.id],
    )
    page = (await res.json()) as Page
    pages.unshift(page)
  }
  return pages
}

// Every page but the oldest is full; a full final page has no cursor.
const pageSizes = (total: number) =>
  Array.from({ length: Math.max(1, Math.ceil(total / 50)) }, (_, i) =>
    i === 0 ? total - 50 * (Math.ceil(total / 50) - 1) : 50,
  )

describe('bounded segment history', () => {
  it.each([1, 49, 50, 51, 101])(
    'pages %i Segments chronologically until the cursor is exhausted',
    async (total) => {
      const rows = history(total)
      answer = pageAnswer(rows)
      const res = await call(pagePath())
      expect(res.status).toBe(200)
      expect(queries[0]).toContain('where user_id = $1 and thread_id = $2')
      expect(queries[0]).toContain('order by created_at desc, id desc limit 51')
      expect(fakeDb.query).toHaveBeenLastCalledWith(expect.any(String), [
        'user_1',
        THREAD,
      ])
      const pages = await drain((await res.json()) as Page)
      expect(pages.map((p) => p.segments.length)).toEqual(pageSizes(total))
      expect(pages.flatMap((p) => p.segments.map((s) => s.id))).toEqual(
        rows.map((r) => r.id),
      )
      expect(fakeDb.query).toHaveBeenCalledTimes(pages.length)
    },
  )

  it('emits the oldest kept row as a microsecond cursor', async () => {
    answer = pageAnswer(history(51))
    const page = (await (await call(pagePath())).json()) as Page
    // Rows 2 and 3 share .000001; row 2 is the older by UUID.
    expect(page.nextCursor).toEqual({
      createdAt: '2026-09-14T10:00:00.000001Z',
      id: uuidFor(2),
    })
    expect(page.segments[0].id).toBe(uuidFor(2))
    expect(page.segments.at(-1)?.id).toBe(uuidFor(51))
  })

  it.each([
    ['timestamp only', 'beforeCreatedAt=2026-09-14T10:00:00.123456Z'],
    ['id only', `beforeId=${SEGMENT}`],
    ['malformed time', `beforeCreatedAt=yesterday&beforeId=${SEGMENT}`],
    [
      'malformed id',
      'beforeCreatedAt=2026-09-14T10:00:00.123456Z&beforeId=row-49',
    ],
    ['year 0000', `beforeCreatedAt=0000-01-01T00:00:00Z&beforeId=${SEGMENT}`],
  ])('rejects a cursor with %s before database access', async (_, cursor) => {
    const res = await call(`/api/segments/page?threadId=${THREAD}&${cursor}`)
    expect(res.status).toBe(400)
    expect(fakeDb.query).not.toHaveBeenCalled()
  })

  it.each(['', 'threadId=not-a-uuid'])(
    'rejects a missing or malformed thread (%j) before database access',
    async (query) => {
      const res = await call(`/api/segments/page?${query}`)
      expect(res.status).toBe(400)
      expect(fakeDb.query).not.toHaveBeenCalled()
    },
  )
})

// Scripts the bootstrap/workspace snapshot row; later cursor pages fall
// through to the same fake history.
const snapshotAnswer =
  (rows: HistoryRow[], snapshot: Row = {}) =>
  (sql: string, params: unknown[]): Answer =>
    sql.startsWith('with ')
      ? {
          rows: [
            {
              characters: [],
              threads: [],
              character_id: CHARACTER,
              thread_id: THREAD,
              segments: newestFirst(rows, sql, []),
              ...snapshot,
            },
          ],
        }
      : pageAnswer(rows)(sql, params)

describe.each([
  ['bootstrap', '/api/app/bootstrap'],
  ['workspace', '/api/app/workspace'],
])('%s head page', (_, route) => {
  it.each([1, 49, 50, 51])(
    'returns the newest of %i Segments and a cursor only when more exist',
    async (total) => {
      const rows = history(total)
      answer = snapshotAnswer(rows)
      const res = await call(`${route}?characterId=${CHARACTER}`)
      expect(res.status).toBe(200)
      expect(queries[0]).toContain('order by created_at desc, id desc limit 51')
      const { segmentPage } = (await res.json()) as { segmentPage: Page }
      expect(segmentPage.segments.map((s) => s.id)).toEqual(
        rows.slice(-50).map((r) => r.id),
      )
      // With 51 rows the 50th-newest is row 2, which shares .000001 with row 3.
      expect(segmentPage.nextCursor).toEqual(
        total > 50
          ? { createdAt: '2026-09-14T10:00:00.000001Z', id: uuidFor(2) }
          : null,
      )
      const pages = await drain(segmentPage)
      expect(pages.map((p) => p.segments.length)).toEqual(pageSizes(total))
      expect(pages.flatMap((p) => p.segments.map((s) => s.id))).toEqual(
        rows.map((r) => r.id),
      )
    },
  )
})

describe('workspace bootstrap', () => {
  it('scopes the roster and selected workspace in one statement', async () => {
    const users = await import('../_lib/users')
    vi.mocked(users.toMeResponse).mockReturnValueOnce({
      id: 'user_1',
    } as ReturnType<typeof users.toMeResponse>)
    answer = snapshotAnswer(history(2))
    const res = await call(`/api/app/bootstrap?characterId=${CHARACTER}`)
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json()).sort()).toEqual([
      'characterId',
      'characters',
      'me',
      'segmentPage',
      'threadId',
      'threads',
    ])
    expect(fakeDb.query).toHaveBeenCalledTimes(1)
    expect(fakeDb.query).toHaveBeenCalledWith(
      expect.stringContaining('where user_id = $1'),
      ['user_1', CHARACTER],
    )
    expect(queries[0]).toContain('(id = $2::uuid) desc nulls last')
  })

  it('passes no preference when characterId is omitted', async () => {
    answer = snapshotAnswer([])
    const res = await call('/api/app/bootstrap')
    expect(res.status).toBe(200)
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [
      'user_1',
      null,
    ])
  })

  it('rejects an invalid preferred Character before database access', async () => {
    const res = await call('/api/app/bootstrap?characterId=invalid')
    expect(res.status).toBe(400)
    expect(fakeDb.query).not.toHaveBeenCalled()
  })
})

describe('character workspace', () => {
  it('reads only the requested owned Character without roster or account', async () => {
    answer = snapshotAnswer(history(2), {
      threads: [
        {
          id: THREAD,
          character_id: CHARACTER,
          user_id: 'user_1',
          title: 'Head',
          starred: false,
          archived_at: null,
          created_at: '2026-09-14T10:00:00Z',
          updated_at: '2026-09-14T10:00:00Z',
          segment_count: 2,
        },
      ],
    })
    const res = await call(`/api/app/workspace?characterId=${CHARACTER}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      characterId: CHARACTER,
      threads: [expect.objectContaining({ id: THREAD, segmentCount: 2 })],
      threadId: THREAD,
      segmentPage: {
        segments: [
          expect.objectContaining({ id: uuidFor(1) }),
          expect.objectContaining({ id: uuidFor(2) }),
        ],
        nextCursor: null,
      },
    })
    expect(fakeDb.query).toHaveBeenCalledTimes(1)
    expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [
      'user_1',
      CHARACTER,
    ])
    expect(queries[0]).toContain(
      'where id = $2::uuid and user_id = $1 and archived_at is null',
    )
    expect(queries[0]).not.toContain('character_list')
  })

  it('returns an empty workspace for an unavailable Character', async () => {
    answer = snapshotAnswer([], { character_id: null, thread_id: null })
    const res = await call(`/api/app/workspace?characterId=${CHARACTER}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      characterId: null,
      threads: [],
      threadId: null,
      segmentPage: { segments: [], nextCursor: null },
    })
  })

  it.each(['', '?characterId=', '?characterId=invalid'])(
    'requires a valid characterId (%j) before database access',
    async (query) => {
      const res = await call(`/api/app/workspace${query}`)
      expect(res.status).toBe(400)
      expect(fakeDb.query).not.toHaveBeenCalled()
    },
  )
})

const ORDER = uuidFor(0x0de7)
const SNAPSHOT = 'begin transaction isolation level repeatable read read only'

// Collapses each query to its table (or the transaction keyword) so tests can
// assert which reads ran inside the snapshot, in order.
const statements = () =>
  queries.map((q) =>
    q.startsWith('begin') || q === 'commit' || q === 'rollback'
      ? q
      : (/ from (\w+)/.exec(q)?.[1] ?? q),
  )

// The snapshot's profile row carries the post-purchase balance; the provisioning
// read (getOrCreateUser, mocked) happens before it.
const creditAnswers =
  (order: Row | null = null) =>
  (sql: string): Answer => {
    if (sql.startsWith('select auth_user_id') && sql.includes('from users'))
      return {
        rows: [
          {
            auth_user_id: 'user_1',
            email: 'a@example.com',
            display_name: null,
            tier: 'free',
            onboarding_complete: true,
            credits_balance: 25200,
            credits_refilled_at: null,
            byok_configured: false,
            openrouter_api_key_last4: null,
            byok_translate_model_id: null,
            byok_explain_model_id: null,
            locale: null,
          },
        ],
      }
    if (sql.includes('from credit_ledger'))
      return {
        rows: [
          {
            id: 'ledger_hold',
            delta: -412,
            reason: 'spend.translate',
            metadata: { reservation: true, estimate: 412 },
            created_at: new Date('2026-10-01T10:00:02.000Z'),
          },
          {
            id: 'ledger_spend',
            delta: -8,
            reason: 'spend.translate',
            metadata: { modelId: 'test/model' },
            created_at: '2026-10-01T12:00:01+02:00',
          },
          {
            id: 'ledger_grant',
            delta: 25000,
            reason: 'grant.purchase',
            metadata: {},
            created_at: new Date('2026-10-01T10:00:00.000Z'),
          },
        ],
      }
    if (sql.includes('from credit_purchases'))
      return { rows: order ? [order] : [] }
    return { rows: [] }
  }

describe('credit history', () => {
  type CreditHistory = {
    me: unknown
    order: { credits: number; fulfilled: boolean } | null
    ledger: unknown[]
    packs: { id: string }[]
  }

  const expectSnapshotResponse = async (res: Response) => {
    const users = await import('../_lib/users')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    // Built from the snapshot row, not the provisioning read's stale balance.
    expect(users.toMeResponse).toHaveBeenCalledTimes(1)
    expect(users.toMeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', creditsBalance: 25200 }),
    )
    const body = (await res.json()) as CreditHistory
    expect(body.me).toEqual({ id: 'snapshot-me' })
    expect(body.ledger).toEqual([
      {
        id: 'ledger_hold',
        delta: -412,
        reason: 'spend.translate',
        pending: true,
        createdAt: '2026-10-01T10:00:02.000Z',
      },
      {
        id: 'ledger_spend',
        delta: -8,
        reason: 'spend.translate',
        pending: false,
        createdAt: '2026-10-01T10:00:01.000Z',
      },
      {
        id: 'ledger_grant',
        delta: 25000,
        reason: 'grant.purchase',
        pending: false,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ])
    expect(body.packs.map((pack) => pack.id)).toEqual([
      'small',
      'medium',
      'large',
    ])
    return body
  }

  beforeEach(async () => {
    const users = await import('../_lib/users')
    vi.mocked(users.getOrCreateUser).mockResolvedValueOnce({
      userId: 'user_1',
      creditsBalance: 200,
    } as Awaited<ReturnType<typeof users.getOrCreateUser>>)
    vi.mocked(users.toMeResponse).mockReturnValueOnce({
      id: 'snapshot-me',
    } as ReturnType<typeof users.toMeResponse>)
  })

  it('reads balance and ledger from one snapshot without an order', async () => {
    answer = creditAnswers()
    const body = await expectSnapshotResponse(
      await call('/api/users/me/credits'),
    )
    expect(body.order).toBeNull()
    expect(statements()).toEqual([SNAPSHOT, 'users', 'credit_ledger', 'commit'])
  })

  it.each([
    ['fulfilled', new Date('2026-10-01T10:00:00.000Z'), true],
    ['unfulfilled', null, false],
  ])(
    'reports a %s order from the same snapshot as the balance',
    async (_, fulfilledAt, fulfilled) => {
      answer = creditAnswers({ credits: 25000, fulfilled_at: fulfilledAt })
      const body = await expectSnapshotResponse(
        await call(`/api/users/me/credits?orderId=${ORDER}`),
      )
      expect(body.order).toEqual({ credits: 25000, fulfilled })
      expect(statements()).toEqual([
        SNAPSHOT,
        'users',
        'credit_ledger',
        'credit_purchases',
        'commit',
      ])
      expect(fakeDb.query).toHaveBeenCalledWith(
        expect.stringContaining('from credit_purchases'),
        [ORDER, 'user_1'],
      )
    },
  )
})

describe('credit checkout', () => {
  it('opens a hosted checkout for the requested pack', async () => {
    answer = (sql) =>
      sql.startsWith('insert into credit_purchases')
        ? { rows: [{ id: ORDER }] }
        : { rows: [] }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/products/prod-small'))
          return Response.json({
            price: { type: 'one_time_price', price: 499, currency: 'USD' },
          })
        if (url.endsWith('/checkouts'))
          return Response.json({
            checkout_url: 'https://checkout.test/credits',
          })
        throw new Error(`unexpected fetch ${url}`)
      })
    const res = await app.request(
      '/api/billing/credits/checkout',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: 'small' }),
      },
      {
        ...env,
        DODO_API_KEY: 'test-key',
        DODO_PRODUCT_CREDITS_SMALL: 'prod-small',
      },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      checkoutUrl: 'https://checkout.test/credits',
    })
    const checkout = fetch.mock.calls.find(([input]) =>
      String(input).endsWith('/checkouts'),
    )
    expect(checkout?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(checkout?.[1]?.body))).toMatchObject({
      product_cart: [{ product_id: 'prod-small', quantity: 1 }],
      customer: { email: 'a@example.com' },
      metadata: { user_id: 'user_1', kind: 'credit_topup' },
    })
    fetch.mockRestore()
  })
})

describe('credit page boundaries', () => {
  it('rejects invalid pack ids before checkout or profile provisioning', async () => {
    const res = await postJson('/api/billing/credits/checkout', {
      pack: 'unlimited',
      credits: 999999,
    })
    expect(res.status).toBe(400)
    expect(queries).toEqual([])
  })
  it('rejects malformed order ids before reading credit history', async () => {
    const res = await call('/api/users/me/credits?orderId=bad')
    expect(res.status).toBe(400)
    expect(queries).toEqual([])
  })
  it('does not reveal another user’s credit order', async () => {
    answer = creditAnswers()
    const res = await call(`/api/users/me/credits?orderId=${SEGMENT}`)
    expect(res.status).toBe(404)
    const lookup = fakeDb.query.mock.calls.find(([sql]) =>
      sql.includes('from credit_purchases'),
    )
    expect(lookup?.[0]).toContain('user_id = $2')
    expect(lookup?.[1]).toEqual([SEGMENT, 'user_1'])
    expect(statements()).toEqual([
      SNAPSHOT,
      'users',
      'credit_ledger',
      'credit_purchases',
      'rollback',
    ])
  })
  it('rejects an unsigned credit payment before touching the database', async () => {
    const res = await app.request(
      '/api/billing/webhooks/dodo',
      {
        method: 'POST',
        body: JSON.stringify({ type: 'payment.succeeded', data: {} }),
      },
      { ...env, DODO_WEBHOOK_SECRET: btoa('test-signing-key') },
    )
    expect(res.status).toBe(400)
    expect(queries).toEqual([])
  })
})

describe('character cap', () => {
  const CHARACTER = '44444444-4444-4444-8444-444444444444'
  const characterRow = {
    id: CHARACTER,
    name: 'Aiko',
    initials: null,
    color: null,
    source_language: 'en-US',
    target_language: 'ja-JP',
    default_vibe: 'casual',
    temperature: '0.4',
    persona: { traits: [] },
    instructions: null,
    sort_order: 0,
    archived_at: null,
    created_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-10T00:00:00.000Z',
  }
  const create = () =>
    postJson('/api/characters', {
      name: 'Aiko',
      sourceLanguage: 'en-US',
      targetLanguage: 'ja-JP',
    })
  const withTier = async (tier: 'free' | 'pro' | 'team') => {
    const users = await import('../_lib/users')
    vi.mocked(users.getOrCreateUser).mockResolvedValueOnce({
      tier,
    } as Awaited<ReturnType<typeof users.getOrCreateUser>>)
  }
  const ownedCharacters = (count: number) => {
    answer = (sql) => {
      if (sql.startsWith('select count(*)::int as count from characters'))
        return { rows: [{ count }] }
      if (sql.startsWith('insert into characters'))
        return { rows: [characterRow] }
      return { rows: [] }
    }
  }

  it.each([
    ['free', 2],
    ['pro', 99],
  ] as const)(
    'creates a %s character under the cap after locking the account',
    async (tier, count) => {
      await withTier(tier)
      ownedCharacters(count)
      const res = await create()
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ id: CHARACTER })
      expect(queries).toEqual([
        'begin',
        'select 1 from users where auth_user_id = $1 for update',
        'select count(*)::int as count from characters where user_id = $1',
        expect.stringMatching(/^insert into characters/),
        'commit',
      ])
    },
  )

  it.each([
    ['free', 3, 'Delete one or upgrade to add more.'],
    ['pro', 100, 'Delete one or upgrade to add more.'],
    ['team', 1000, 'Delete one to add another.'],
  ] as const)(
    'rejects a %s account at its cap of %i without inserting',
    async (tier, limit, hint) => {
      await withTier(tier)
      ownedCharacters(limit)
      const res = await create()
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({
        error: {
          message: `Your plan includes up to ${limit} saved characters. ${hint}`,
        },
      })
      expect(queries.some((q) => q.startsWith('insert into characters'))).toBe(
        false,
      )
      expect(queries.at(-1)).toBe('rollback')
    },
  )
})
