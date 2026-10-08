import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bootstrapOptions,
  seedFirstPage,
  type AppBootstrap,
} from '../app-bootstrap'
import { keys } from '../query-keys'
import type { SegmentHistory } from '../segment-history'
import type { Character, Thread } from '../types'
import {
  deferred,
  makeCharacter,
  makeMe,
  makePage,
  makeSegment,
  makeThread,
} from './test-fixtures'

const page = makePage(
  [
    makeSegment('s1', '2026-10-01T00:00:00.000Z'),
    makeSegment('s2', '2026-10-02T00:00:00.000Z'),
  ],
  true,
)
const snapshot = {
  me: makeMe(),
  characters: [makeCharacter('c1'), makeCharacter('c2', { sortOrder: 1 })],
  characterId: 'c1',
  threads: [makeThread('t1', 'c1', { segmentCount: 51 })],
  threadId: 't1',
  segmentPage: page,
} satisfies AppBootstrap

const clients: QueryClient[] = []
const client = () => {
  const qc = new QueryClient()
  clients.push(qc)
  return qc
}
afterEach(() => {
  clients.splice(0).forEach((qc) => qc.clear())
  vi.unstubAllGlobals()
})

// Holds the bootstrap response until the test releases it. `started` resolves
// once the request reaches fetch, so caches can be changed mid-flight.
function stubSnapshot() {
  const started = deferred<void>()
  const response = deferred<Response>()
  const fetch = vi.fn((_input: RequestInfo | URL) => {
    started.resolve()
    return response.promise
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, started: started.promise, finish: response.resolve }
}

describe('bootstrap seeding', () => {
  it('seeds every missing domain key from a populated snapshot', async () => {
    const { fetch, finish } = stubSnapshot()
    const qc = client()
    const pending = qc.fetchQuery(bootstrapOptions(qc, 'c1'))
    finish(Response.json(snapshot))
    await expect(pending).resolves.toEqual(snapshot)
    expect(fetch.mock.calls[0][0]).toBe('/api/app/bootstrap?characterId=c1')
    expect(qc.getQueryData(keys.me)).toEqual(snapshot.me)
    expect(qc.getQueryData(keys.characters)).toEqual(snapshot.characters)
    expect(qc.getQueryData(keys.threads('c1'))).toEqual(snapshot.threads)
    expect(qc.getQueryData(keys.segments('t1'))).toEqual({
      pages: [page],
      pageParams: [null],
    } satisfies SegmentHistory)
  })

  it('does not seed a cancelled account response even when fetch ignores abort', async () => {
    const { started, finish } = stubSnapshot()
    const qc = client()
    const pending = qc
      .fetchQuery(bootstrapOptions(qc, 'c1'))
      .catch(() => undefined)
    await started
    qc.clear()
    const other: Character[] = [makeCharacter('b1')]
    qc.setQueryData(keys.characters, other)
    finish(Response.json(snapshot))
    await pending
    await new Promise((r) => setTimeout(r, 0))
    expect(qc.getQueryData(keys.characters)).toBe(other)
    expect(qc.getQueryData(keys.me)).toBeUndefined()
    expect(qc.getQueryData(keys.threads('c1'))).toBeUndefined()
    expect(qc.getQueryData(keys.segments('t1'))).toBeUndefined()
  })

  it('does not replace domain data written while the snapshot is in flight', async () => {
    const { started, finish } = stubSnapshot()
    const qc = client()
    const pending = qc.fetchQuery(bootstrapOptions(qc, 'c1'))
    await started
    const characters = [makeCharacter('c1'), makeCharacter('c3')]
    const threads: Thread[] = [
      makeThread('t9', 'c1'),
      makeThread('t1', 'c1', { segmentCount: 52 }),
    ]
    const loaded = makePage([makeSegment('s0', '2026-09-01T00:00:00.000Z')])
    const history: SegmentHistory = {
      pages: [
        makePage([
          ...page.segments,
          makeSegment('s3', '2026-10-03T00:00:00.000Z'),
        ]),
        loaded,
      ],
      pageParams: [null, page.nextCursor],
    }
    qc.setQueryData(keys.characters, characters)
    qc.setQueryData(keys.threads('c1'), threads)
    qc.setQueryData(keys.segments('t1'), history)
    finish(Response.json(snapshot))
    await pending
    expect(qc.getQueryData(keys.characters)).toBe(characters)
    expect(qc.getQueryData(keys.threads('c1'))).toBe(threads)
    expect(qc.getQueryData(keys.segments('t1'))).toBe(history)
    // Missing keys are still seeded.
    expect(qc.getQueryData(keys.me)).toEqual(snapshot.me)
  })
})

describe('seedFirstPage', () => {
  it('seeds a missing history and leaves a loaded one alone', () => {
    const qc = client()
    seedFirstPage(qc, snapshot)
    expect(qc.getQueryData(keys.segments('t1'))).toEqual({
      pages: [page],
      pageParams: [null],
    })
    const loaded = qc.getQueryData(keys.segments('t1'))
    seedFirstPage(qc, { ...snapshot, segmentPage: makePage([]) })
    expect(qc.getQueryData(keys.segments('t1'))).toBe(loaded)
  })

  it('ignores a workspace without a selected Thread', () => {
    const qc = client()
    seedFirstPage(qc, {
      characterId: 'c1',
      threads: [],
      threadId: null,
      segmentPage: makePage([]),
    })
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
})
