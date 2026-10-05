import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

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
  it('keeps the new Segment when an older GET finishes after create', async () => {
    const qc = client()
    qc.setQueryData<Segment[]>(keys.segments('t1'), [])
    const oldGet = deferred<Segment[]>()
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
    oldGet.resolve([])
    await stale
    expect(qc.getQueryData(keys.segments('t1'))).toEqual([segment])
  })

  it('refetches an unloaded segment list after create rather than losing the new row', async () => {
    const qc = client()
    const oldGet = deferred<Segment[]>()
    let reads = 0
    const observer = new QueryObserver(qc, {
      queryKey: keys.segments('t1'),
      queryFn: () =>
        ++reads === 1 ? oldGet.promise : Promise.resolve([segment]),
    })
    const unsubscribe = observer.subscribe(() => undefined)
    const mutation = new MutationObserver(
      qc,
      createSegmentOptions(qc, async () => segment),
    )
    await mutation.mutate({ threadId: 't1', sourceText: 'hello' })
    oldGet.resolve([])
    await Promise.resolve()
    expect(qc.getQueryData(keys.segments('t1'))).toEqual([segment])
    unsubscribe()
  })
})
