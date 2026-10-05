import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level tests for the share capability and the credit ordering around
// translate/retry. Every I/O module is mocked; the fake pg client answers by
// SQL substring, so each test scripts exactly the rows its path needs.

type Row = Record<string, unknown>
type Answer = { rows: Row[]; rowCount?: number } | Error
let answer: (sql: string, params: unknown[]) => Answer
const queries: string[] = []

const fakeDb = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    queries.push(norm)
    const result = answer(norm, params)
    if (result instanceof Error) throw result
    return { rowCount: result.rows.length, ...result }
  }),
}

vi.mock('../_lib/auth', () => ({
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
vi.mock('../_lib/users', () => ({
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
    expect(credits.refundReservation).not.toHaveBeenCalled()
    errors.mockRestore()
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
