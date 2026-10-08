import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value)
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key)
  }),
}))
import { get, set } from 'idb-keyval'
import { QueryCachePersistence } from '../query-cache-store'

const prefix = 'vibe-translate:query-cache'
const saved = (userId: string) => ({
  userId,
  entries: [
    {
      queryKey: ['threads'],
      data: [`${userId}'s private thread`],
      dataUpdatedAt: 123,
    },
  ],
})
beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
})

describe('account-scoped query persistence', () => {
  it('offline reload uses only the last confirmed owner and preserves staleness', async () => {
    storage.set(`${prefix}:owner`, 'a')
    storage.set(`${prefix}:a`, saved('a'))
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    await persistence.activate(undefined)
    expect(client.getQueryData(['threads'])).toEqual(["a's private thread"])
    expect(client.getQueryState(['threads'])?.dataUpdatedAt).toBe(123)
    persistence.stop()
  })

  it('account B cannot see A’s memory or disk data, including private non-persisted queries', async () => {
    storage.set(`${prefix}:owner`, 'a')
    storage.set(`${prefix}:a`, saved('a'))
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    await persistence.activate('a')
    client.setQueryData(['me'], { email: 'a@example.com' })
    await persistence.activate('b')
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(client.getQueryData(['me'])).toBeUndefined()
    expect(storage.has(`${prefix}:a`)).toBe(false)
    expect(storage.get(`${prefix}:owner`)).toBe('b')
    persistence.stop()
  })

  it('sign-out waits for an in-flight write, blocks later writes, and clears the owner', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    await persistence.activate('a')
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(set).mockImplementationOnce(async (key, value) => {
      await blocked
      storage.set(String(key), value)
    })
    client.setQueryData(['threads'], ['private'])
    // Flush the debounce without waiting for the deliberately blocked write.
    vi.advanceTimersByTime(300)
    await Promise.resolve()
    expect(set).toHaveBeenLastCalledWith(`${prefix}:a`, expect.anything())
    const clear = persistence.clear()
    expect(client.getQueryData(['threads'])).toBeUndefined()
    client.setQueryData(['threads'], ['late old request'])
    release()
    await clear
    expect(storage.has(`${prefix}:a`)).toBe(false)
    expect(storage.has(`${prefix}:owner`)).toBe(false)
    const reload = new QueryClient()
    const next = new QueryCachePersistence(reload)
    await next.activate(undefined)
    expect(reload.getQueryData(['threads'])).toBeUndefined()
    next.stop()
    vi.useRealTimers()
  })

  it('migrates account-owned pre-pagination history for offline access', async () => {
    storage.set(`${prefix}:a`, {
      userId: 'a',
      entries: [
        {
          queryKey: ['segments', 't'],
          data: [{ id: 'old' }],
          dataUpdatedAt: 123,
        },
      ],
    })
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    await persistence.activate('a')
    expect(client.getQueryData(['segment-pages', 't'])).toEqual({
      pages: [{ segments: [{ id: 'old' }], nextCursor: null }],
      pageParams: [null],
    })
    expect(client.getQueryState(['segment-pages', 't'])?.dataUpdatedAt).toBe(
      123,
    )
    persistence.stop()
  })

  it('discards legacy and mismatched caches', async () => {
    storage.set(prefix, [[['threads'], ['legacy private data']]])
    storage.set(`${prefix}:b`, saved('a'))
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    await persistence.activate('b')
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(storage.has(prefix)).toBe(false)
    persistence.stop()
  })

  it('ignores hydration that resolves after an account change', async () => {
    storage.set(`${prefix}:owner`, 'a')
    let release!: (value: unknown) => void
    vi.mocked(get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    const old = persistence.activate(undefined)
    await Promise.resolve()
    const next = persistence.activate('b')
    release('a')
    await Promise.all([old, next])
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(storage.get(`${prefix}:owner`)).toBe('b')
    persistence.stop()
  })
})

describe('persistence work', () => {
  it('session hydration does not cancel an active public share resolver', async () => {
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    let finish!: (value: string) => void
    let signal!: AbortSignal
    const observer = new QueryObserver(client, {
      queryKey: ['share-public', 'capability'],
      queryFn: (context) => {
        signal = context.signal
        return new Promise<string>((resolve) => {
          finish = resolve
        })
      },
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await persistence.activate('a')
    expect(signal.aborted).toBe(false)
    finish('redacted public content')
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toBe('redacted public content'),
    )
    unsubscribe()
    persistence.stop()
    client.clear()
  })

  it('coalesces a burst of data updates and ignores observer/nonpersisted notifications', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const persistence = new QueryCachePersistence(client)
    try {
      await persistence.activate('a')
      vi.mocked(set).mockClear()
      for (let i = 0; i < 100; i++)
        client.setQueryData(['segment-pages', 't'], [i])
      client.setQueryData(['me'], { balance: 5 })
      await vi.advanceTimersByTimeAsync(300)
      expect(set).toHaveBeenCalledTimes(1)
      expect(storage.get(`${prefix}:a`)).toMatchObject({
        entries: [{ data: [99] }],
      })
      vi.mocked(set).mockClear()
      await client.fetchQuery({
        queryKey: ['me'],
        queryFn: async () => ({ balance: 6 }),
      })
      await vi.advanceTimersByTimeAsync(300)
      expect(set).not.toHaveBeenCalled()
    } finally {
      persistence.stop()
      client.clear()
      vi.useRealTimers()
    }
  })
})
