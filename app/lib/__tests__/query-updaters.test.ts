import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  appendSegment,
  applyServerThread,
  patchThread,
  touchThread,
} from '../query-updaters'
import type { Segment, Thread } from '../types'

const seg = (id: string): Segment => ({
  id,
  threadId: 't1',
  sourceText: 'hi',
  targetText: 'やあ',
  vibe: null,
  tokenAlignment: [],
  tokenUsage: {},
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:00:00.000Z',
})

const thread = (
  id: string,
  updatedAt: string,
  extra: Partial<Thread> = {},
): Thread => ({
  id,
  characterId: 'c1',
  title: id,
  starred: false,
  segmentCount: 1,
  archivedAt: null,
  createdAt: updatedAt,
  updatedAt,
  ...extra,
})

describe('appendSegment', () => {
  it('appends a new row', () => {
    const { list, appended } = appendSegment([seg('a')], seg('b'))
    expect(appended).toBe(true)
    expect(list?.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('reports a de-duped row as not appended', () => {
    const prev = [seg('a')]
    const { list, appended } = appendSegment(prev, seg('a'))
    expect(appended).toBe(false)
    expect(list).toBe(prev)
  })

  it('leaves an unloaded list unloaded (unknown)', () => {
    expect(appendSegment(undefined, seg('a'))).toEqual({
      list: undefined,
      appended: null,
    })
  })
})

describe('touchThread', () => {
  it('bumps count/recency and re-sorts newest first', () => {
    const list = [
      thread('new', '2026-09-14T10:00:00.000Z'),
      thread('old', '2026-09-01T10:00:00.000Z'),
    ]
    const out = touchThread(list, 'old', '2026-09-14T11:00:00.000Z', 1)
    expect(out?.map((t) => t.id)).toEqual(['old', 'new'])
    expect(out?.[0].segmentCount).toBe(2)
  })
})

describe('thread patching', () => {
  it('drops a thread optimistically on archive and keeps it on star', () => {
    const list = [
      thread('a', '2026-09-14T10:00:00.000Z'),
      thread('b', '2026-09-13T10:00:00.000Z'),
    ]
    expect(patchThread(list, 'a', { archived: true }).map((t) => t.id)).toEqual(
      ['b'],
    )
    const starred = patchThread(list, 'a', { starred: true })
    expect(starred[0]).toMatchObject({ id: 'a', starred: true })
    // `archived` is a request flag, never a Thread field.
    expect('archived' in starred[0]).toBe(false)
  })

  it('removes a server row that came back archived', () => {
    const list = [thread('a', '2026-09-14T10:00:00.000Z')]
    const archived = thread('a', '2026-09-14T10:00:00.000Z', {
      archivedAt: '2026-09-14T12:00:00.000Z',
    })
    expect(applyServerThread(list, archived)).toEqual([])
  })
})

// The create-segment cache flow as wired in use-app-data: a de-duped response
// must not inflate the sidebar count.
describe('create-segment cache flow', () => {
  const run = (qc: QueryClient, created: Segment) => {
    let appended: boolean | null = null
    qc.setQueryData<Segment[]>(['segments', 't1'], (prev) => {
      const result = appendSegment(prev, created)
      appended = result.appended
      return result.list
    })
    if (appended === true) {
      qc.setQueriesData<Thread[]>({ queryKey: ['threads'] }, (list) =>
        touchThread(list, 't1', created.createdAt, 1),
      )
    }
  }

  it('counts an insert once and ignores a dedupe replay', () => {
    const qc = new QueryClient()
    qc.setQueryData<Segment[]>(['segments', 't1'], [])
    qc.setQueryData<Thread[]>(
      ['threads', 'c1'],
      [thread('t1', '2026-09-01T00:00:00.000Z', { segmentCount: 0 })],
    )
    run(qc, seg('s1'))
    run(qc, seg('s1'))
    expect(qc.getQueryData<Thread[]>(['threads', 'c1'])?.[0].segmentCount).toBe(
      1,
    )
    expect(qc.getQueryData<Segment[]>(['segments', 't1'])).toHaveLength(1)
  })
})
