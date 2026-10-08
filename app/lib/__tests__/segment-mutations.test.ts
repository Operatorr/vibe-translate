import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { historySegments, type SegmentHistory } from '../segment-history'
import { keys } from '../query-keys'
import { createSegmentOptions } from '../segment-mutations'
import type { Segment } from '../types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const segment: Segment = {
  id: 'new',
  threadId: 't1',
  sourceText: 'hello',
  targetText: 'やあ',
  vibe: 'casual',
  tokenAlignment: [],
  tokenUsage: {},
  createdAt: '2026-10-05T10:00:00Z',
  updatedAt: '2026-10-05T10:00:00Z',
}

const history = (segments: Segment[]): SegmentHistory => ({
  pages: [{ segments, nextCursor: null }],
  pageParams: [null],
})

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
      async () => segment,
      () => owner,
    )
    const response = options.onSuccess(segment, {
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
    const provider = deferred<Segment>()
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
    provider.resolve(segment)
    await sent
    oldGet.resolve(history([]))
    await stale
    expect(historySegments(qc.getQueryData(keys.segments('t1')))).toEqual([
      segment,
    ])
  })

  it('preserves older pages and cursors when merging a successful create', async () => {
    const qc = client()
    const cursor = { id: 'boundary', createdAt: '2026-01-01T00:00:00.123456Z' }
    const old = { ...segment, id: 'old' }
    qc.setQueryData<SegmentHistory>(keys.segments('t1'), {
      pages: [
        { segments: [], nextCursor: cursor },
        { segments: [old], nextCursor: null },
      ],
      pageParams: [null, cursor],
    })
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => segment),
    )
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    const saved = qc.getQueryData<SegmentHistory>(keys.segments('t1'))!
    expect(historySegments(saved)).toEqual([old, segment])
    expect(saved.pages[0].nextCursor).toEqual(cursor)
    expect(saved.pageParams).toEqual([null, cursor])
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    expect(historySegments(qc.getQueryData(keys.segments('t1')))).toEqual([
      old,
      segment,
    ])
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
      createSegmentOptions(qc, async () => segment),
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
