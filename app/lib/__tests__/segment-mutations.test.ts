import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  historySegments,
  type SegmentCursor,
  type SegmentHistory,
  type SegmentPage,
} from '../segment-history'
import { keys } from '../query-keys'
import { createSegmentOptions } from '../segment-mutations'
import type { CreatedSegment, Segment, Thread } from '../types'
import { deferred, makePage, makeSegment, makeThread } from './test-fixtures'

const segment = makeSegment('new', '2026-10-05T10:00:00.000Z')
const created: CreatedSegment = { ...segment, reused: false }

const history = (segments: Segment[]): SegmentHistory => ({
  pages: [makePage(segments)],
  pageParams: [null],
})
const ids = (qc: QueryClient) =>
  historySegments(qc.getQueryData(keys.segments('t1'))).map((s) => s.id)

const clients: QueryClient[] = []
const client = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(qc)
  return qc
}
afterEach(() => clients.splice(0).forEach((qc) => qc.clear()))

describe('create-segment mutations', () => {
  it('does not merge an old account response if ownership switches during cancellation', async () => {
    const qc = client()
    let owner = 'a'
    const paused = deferred<void>()
    vi.spyOn(qc, 'cancelQueries').mockReturnValueOnce(paused.promise)
    const options = createSegmentOptions(
      qc,
      async () => created,
      () => owner,
    )
    const response = options.onSuccess(created, {
      threadId: 't1',
      sourceText: 'hello',
    })
    owner = 'b'
    const current = history([{ ...segment, id: 'b-only' }])
    qc.setQueryData(keys.segments('t1'), current)
    paused.resolve()
    await response
    expect(qc.getQueryData(keys.segments('t1'))).toEqual(current)
  })

  it('keeps the new Segment when an older GET finishes after create', async () => {
    const qc = client()
    qc.setQueryData<SegmentHistory>(keys.segments('t1'), history([]))
    const oldGet = deferred<SegmentHistory>()
    const provider = deferred<CreatedSegment>()
    const called = deferred<void>()
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, () => {
        called.resolve()
        return provider.promise
      }),
    )
    const sent = mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    await called.promise
    // A refetch can begin while the provider call is in flight, even after onMutate.
    const stale = qc
      .fetchQuery({
        queryKey: keys.segments('t1'),
        queryFn: () => oldGet.promise,
      })
      .catch(() => undefined)
    provider.resolve(created)
    // The UI still sees `reused`; the cache stores a plain Segment.
    await expect(sent).resolves.toEqual(created)
    oldGet.resolve(history([]))
    await stale
    expect(historySegments(qc.getQueryData(keys.segments('t1')))).toEqual([
      segment,
    ])
  })

  it('preserves older pages and cursors, and counts a replayed create once', async () => {
    const qc = client()
    const old = makeSegment('old', '2026-01-01T00:00:00.000Z')
    const boundary = makeSegment('boundary', '2026-02-01T00:00:00.000Z')
    const recent = makeSegment('recent', '2026-10-04T00:00:00.000Z')
    const newest = makePage([boundary, recent], true)
    const older = makePage([old])
    qc.setQueryData<SegmentHistory>(keys.segments('t1'), {
      pages: [newest, older],
      pageParams: [null, newest.nextCursor],
    })
    qc.setQueryData<Thread[]>(keys.threads('c1'), [
      makeThread('t2', 'c1', { updatedAt: '2026-10-01T00:00:00.000Z' }),
      makeThread('t1', 'c1', {
        segmentCount: 3,
        updatedAt: '2026-09-01T00:00:00.000Z',
      }),
    ])
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => created),
    )
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    const saved = qc.getQueryData<SegmentHistory>(keys.segments('t1'))!
    expect(saved.pages.map((page) => page.segments)).toEqual([
      [boundary, recent, segment],
      [old],
    ])
    expect(saved.pages[0].nextCursor).toEqual(newest.nextCursor)
    expect(saved.pages[1]).toBe(older)
    expect(saved.pageParams).toEqual([null, newest.nextCursor])
    expect(ids(qc)).toEqual(['old', 'boundary', 'recent', 'new'])
    const touched = qc.getQueryData<Thread[]>(keys.threads('c1'))!
    expect(touched.map((t) => [t.id, t.segmentCount, t.updatedAt])).toEqual([
      ['t1', 4, segment.createdAt],
      ['t2', 0, '2026-10-01T00:00:00.000Z'],
    ])
    // The same id again (a replayed response) must not append or count twice.
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    expect(ids(qc)).toEqual(['old', 'boundary', 'recent', 'new'])
    expect(qc.getQueryData(keys.threads('c1'))).toEqual(touched)
  })

  it('leaves an older dedupe hit in its unloaded page, then loads it once', async () => {
    const qc = client()
    const old = makeSegment('old', '2026-01-01T00:00:00.000Z')
    const recent = makeSegment('recent', '2026-10-04T00:00:00.000Z')
    const newest = makePage([recent], true)
    const older = makePage([old])
    qc.setQueryData<SegmentHistory>(keys.segments('t1'), {
      pages: [newest],
      pageParams: [null],
    })
    const threads = [
      makeThread('t1', 'c1', {
        segmentCount: 2,
        updatedAt: recent.createdAt,
      }),
    ]
    qc.setQueryData<Thread[]>(keys.threads('c1'), threads)
    const reads: (SegmentCursor | null)[] = []
    const observer = new InfiniteQueryObserver<
      SegmentPage,
      Error,
      SegmentHistory,
      ReturnType<typeof keys.segments>,
      SegmentCursor | null
    >(qc, {
      queryKey: keys.segments('t1'),
      initialPageParam: null,
      queryFn: async ({ pageParam }) => {
        reads.push(pageParam)
        return pageParam ? older : newest
      },
      getNextPageParam: (page) => page.nextCursor,
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => undefined)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => ({ ...old, reused: true })),
    )
    await expect(
      mutation.mutate({ threadId: 't1', sourceText: old.sourceText }),
    ).resolves.toEqual({ ...old, reused: true })
    expect(ids(qc)).toEqual(['recent'])
    expect(qc.getQueryData(keys.threads('c1'))).toBe(threads)
    expect(invalidate).not.toHaveBeenCalled()

    await observer.fetchNextPage()
    expect(reads).toEqual([newest.nextCursor])
    expect(ids(qc)).toEqual(['old', 'recent'])
    expect(qc.getQueryData(keys.threads('c1'))).toBe(threads)
    unsubscribe()
  })

  it('refetches history that is missing a newer dedupe hit', async () => {
    const qc = client()
    const recent = makeSegment('recent', '2026-10-04T00:00:00.000Z')
    const elsewhere = makeSegment('elsewhere', '2026-10-04T12:00:00.000Z')
    let reads = 0
    const observer = new QueryObserver(qc, {
      queryKey: keys.segments('t1'),
      queryFn: () => {
        reads += 1
        return history([recent, elsewhere])
      },
      staleTime: Infinity,
    })
    qc.setQueryData<SegmentHistory>(keys.segments('t1'), history([recent]))
    const unsubscribe = observer.subscribe(() => undefined)
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => ({ ...elsewhere, reused: true })),
    )
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    expect(reads).toBe(1)
    expect(ids(qc)).toEqual(['recent', 'elsewhere'])
    unsubscribe()
  })

  it('refetches an unloaded segment list after create rather than losing the new row', async () => {
    const qc = client()
    const oldGet = deferred<SegmentHistory>()
    let reads = 0
    const observer = new QueryObserver(qc, {
      queryKey: keys.segments('t1'),
      queryFn: () =>
        ++reads === 1 ? oldGet.promise : Promise.resolve(history([segment])),
    })
    const unsubscribe = observer.subscribe(() => undefined)
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => created),
    )
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    oldGet.resolve(history([]))
    await Promise.resolve()
    expect(historySegments(qc.getQueryData(keys.segments('t1')))).toEqual([
      segment,
    ])
    unsubscribe()
  })
})
