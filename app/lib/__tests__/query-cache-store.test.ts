import { getEventListeners } from 'node:events'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, unknown>())
// IndexedDB stores structured clones, never the live Query objects.
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => structuredClone(storage.get(key))),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value))
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key)
  }),
}))
import { get, set } from 'idb-keyval'
import { PERSIST_DELAY_MS, QueryCachePersistence } from '../query-cache-store'
import type { SegmentHistory } from '../segment-history'

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
const segment = (id: string, createdAt: string) => ({
  id,
  threadId: 't',
  sourceText: `source ${id}`,
  targetText: `target ${id}`,
  vibe: null,
  tokenAlignment: [],
  tokenUsage: {},
  createdAt,
  updatedAt: createdAt,
})
// Two loaded pages: the head page and one older page fetched by cursor.
const olderCursor = { createdAt: '2026-10-01T12:00:00.123456Z', id: 's0' }
const history = (latest: number): SegmentHistory => ({
  pages: [
    {
      segments: [segment(`s${latest}`, '2026-10-02T08:00:00.000001Z')],
      nextCursor: olderCursor,
    },
    { segments: [segment('s0', olderCursor.createdAt)], nextCursor: null },
  ],
  pageParams: [null, olderCursor],
})

const cleanup: (() => void)[] = []
function persisted() {
  const client = new QueryClient()
  const persistence = new QueryCachePersistence(client)
  cleanup.push(() => {
    persistence.stop()
    client.clear()
  })
  return { client, persistence }
}
beforeEach(() => {
  storage.clear()
  vi.clearAllMocks()
})
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('account-scoped query persistence', () => {
  it('offline reload uses only the last confirmed owner and preserves staleness', async () => {
    storage.set(`${prefix}:owner`, 'a')
    storage.set(`${prefix}:a`, saved('a'))
    const { client, persistence } = persisted()
    await persistence.activate(undefined)
    expect(client.getQueryData(['threads'])).toEqual(["a's private thread"])
    expect(client.getQueryState(['threads'])?.dataUpdatedAt).toBe(123)
  })

  it('account B cannot see A’s memory or disk data, including private non-persisted queries', async () => {
    storage.set(`${prefix}:owner`, 'a')
    storage.set(`${prefix}:a`, saved('a'))
    const { client, persistence } = persisted()
    await persistence.activate('a')
    client.setQueryData(['me'], { email: 'a@example.com' })
    await persistence.activate('b')
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(client.getQueryData(['me'])).toBeUndefined()
    expect(storage.has(`${prefix}:a`)).toBe(false)
    expect(storage.get(`${prefix}:owner`)).toBe('b')
  })

  it('sign-out waits for an in-flight write, blocks later writes, and clears the owner', async () => {
    vi.useFakeTimers()
    const { client, persistence } = persisted()
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
    vi.advanceTimersByTime(PERSIST_DELAY_MS)
    await Promise.resolve()
    expect(set).toHaveBeenLastCalledWith(`${prefix}:a`, expect.anything())
    const clear = persistence.clear()
    expect(client.getQueryData(['threads'])).toBeUndefined()
    client.setQueryData(['threads'], ['late old request'])
    release()
    await clear
    expect(storage.has(`${prefix}:a`)).toBe(false)
    expect(storage.has(`${prefix}:owner`)).toBe(false)
    const reload = persisted()
    await reload.persistence.activate(undefined)
    expect(reload.client.getQueryData(['threads'])).toBeUndefined()
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
    const { client, persistence } = persisted()
    await persistence.activate('a')
    expect(client.getQueryData(['segment-pages', 't'])).toEqual({
      pages: [{ segments: [{ id: 'old' }], nextCursor: null }],
      pageParams: [null],
    })
    expect(client.getQueryState(['segment-pages', 't'])?.dataUpdatedAt).toBe(
      123,
    )
  })

  it('discards legacy and mismatched caches', async () => {
    storage.set(prefix, [[['threads'], ['legacy private data']]])
    storage.set(`${prefix}:b`, saved('a'))
    const { client, persistence } = persisted()
    await persistence.activate('b')
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(storage.has(prefix)).toBe(false)
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
    const { client, persistence } = persisted()
    const old = persistence.activate(undefined)
    await Promise.resolve()
    const next = persistence.activate('b')
    release('a')
    await Promise.all([old, next])
    expect(client.getQueryData(['threads'])).toBeUndefined()
    expect(storage.get(`${prefix}:owner`)).toBe('b')
  })
})

describe('persistence work', () => {
  it('session hydration does not cancel an active public share resolver', async () => {
    const { client, persistence } = persisted()
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
    cleanup.push(unsubscribe)
    await persistence.activate('a')
    expect(signal.aborted).toBe(false)
    finish('redacted public content')
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toBe('redacted public content'),
    )
  })

  it('coalesces a burst of history updates into one write that hydrates with its cursors', async () => {
    vi.useFakeTimers()
    const { client, persistence } = persisted()
    await persistence.activate('a')
    vi.mocked(set).mockClear()
    for (let i = 1; i <= 100; i++)
      client.setQueryData(['segment-pages', 't'], history(i))
    client.setQueryData(['me'], { balance: 5 })
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS - 1)
    expect(set).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(set).toHaveBeenCalledTimes(1)
    expect(storage.get(`${prefix}:a`)).toEqual({
      userId: 'a',
      entries: [
        {
          queryKey: ['segment-pages', 't'],
          data: history(100),
          dataUpdatedAt: expect.any(Number),
        },
      ],
    })
    persistence.stop()
    const reload = persisted()
    await reload.persistence.activate('a')
    expect(reload.client.getQueryData(['segment-pages', 't'])).toEqual(
      history(100),
    )
  })

  it('observer, option and fetch notifications on a persisted key wait for its data', async () => {
    vi.useFakeTimers()
    const { client, persistence } = persisted()
    await persistence.activate('a')
    vi.mocked(set).mockClear()
    let respond!: (threads: string[]) => void
    const options = {
      queryKey: ['threads', 'c'],
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          respond = resolve
        }),
    }
    const observer = new QueryObserver(client, { ...options, enabled: false })
    cleanup.push(observer.subscribe(() => undefined))
    // A re-render enables the observer, which starts the deferred fetch.
    observer.setOptions({ ...options, staleTime: 1_000 })
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2)
    expect(client.getQueryState(['threads', 'c'])?.fetchStatus).toBe('fetching')
    expect(set).not.toHaveBeenCalled()
    respond(['thread'])
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS - 1)
    expect(set).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(set).toHaveBeenCalledTimes(1)
    expect(storage.get(`${prefix}:a`)).toMatchObject({
      entries: [{ queryKey: ['threads', 'c'], data: ['thread'] }],
    })
  })

  it('ignores fetches of non-persisted queries', async () => {
    vi.useFakeTimers()
    const { client, persistence } = persisted()
    await persistence.activate('a')
    vi.mocked(set).mockClear()
    await client.fetchQuery({
      queryKey: ['me'],
      queryFn: async () => ({ balance: 6 }),
    })
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(set).not.toHaveBeenCalled()
  })

  it('persists removals, so a removed query does not hydrate again', async () => {
    vi.useFakeTimers()
    const { client, persistence } = persisted()
    await persistence.activate('a')
    client.setQueryData(['threads', 'c'], ['kept'])
    client.setQueryData(['threads', 'd'], ['deleted Character'])
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(storage.get(`${prefix}:a`)).toMatchObject({
      entries: [{ queryKey: ['threads', 'c'] }, { queryKey: ['threads', 'd'] }],
    })
    vi.mocked(set).mockClear()
    client.removeQueries({ queryKey: ['threads', 'd'] })
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(set).toHaveBeenCalledTimes(1)
    persistence.stop()
    const reload = persisted()
    await reload.persistence.activate('a')
    expect(reload.client.getQueryData(['threads', 'c'])).toEqual(['kept'])
    expect(reload.client.getQueryData(['threads', 'd'])).toBeUndefined()
  })
})

describe('page lifecycle', () => {
  let browser: EventTarget
  let page: EventTarget & { visibilityState: DocumentVisibilityState }
  let session: ReturnType<typeof persisted>
  const written = (owner: string, data: unknown) =>
    expect(set).toHaveBeenCalledExactlyOnceWith(`${prefix}:${owner}`, {
      userId: owner,
      entries: [expect.objectContaining({ data })],
    })

  beforeEach(async () => {
    vi.useFakeTimers()
    browser = new EventTarget()
    page = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', page)
    session = persisted()
    await session.persistence.activate('a')
    vi.mocked(set).mockClear()
  })

  it('pagehide writes pending data before the debounce elapses', async () => {
    session.client.setQueryData(['threads', 'c'], ['draft'])
    browser.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    written('a', ['draft'])
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('only a hidden visibilitychange writes pending data early', async () => {
    session.client.setQueryData(['threads', 'c'], ['draft'])
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(set).not.toHaveBeenCalled()
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    written('a', ['draft'])
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('stop() detaches the listeners and drops pending work', async () => {
    session.client.setQueryData(['threads', 'c'], ['draft'])
    session.persistence.stop()
    page.visibilityState = 'hidden'
    browser.dispatchEvent(new Event('pagehide'))
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS)
    expect(set).not.toHaveBeenCalled()
    expect(getEventListeners(browser, 'pagehide')).toHaveLength(0)
    expect(getEventListeners(page, 'visibilitychange')).toHaveLength(0)
  })

  it('an account change replaces the previous owner’s listeners', async () => {
    await session.persistence.activate('b')
    vi.mocked(set).mockClear()
    session.client.setQueryData(['threads', 'c'], ["b's thread"])
    // A leftover listener for A would run first, cancel B's pending write as
    // stale, and leave nothing to flush.
    browser.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    written('b', ["b's thread"])
    expect(getEventListeners(browser, 'pagehide')).toHaveLength(1)
    expect(getEventListeners(page, 'visibilitychange')).toHaveLength(1)
  })
})
