import { describe, expect, it } from 'vitest'

import {
  appendHistory,
  historySegments,
  replaceHistory,
  type SegmentHistory,
} from '../segment-history'
import { cursorOf, makePage, makeSegment } from './test-fixtures'

const oldest = makeSegment('oldest', '2026-01-01T00:00:00.000Z')
const old = makeSegment('old', '2026-01-02T00:00:00.000Z')
const boundary = makeSegment('boundary', '2026-02-01T00:00:00.000Z')
const recent = makeSegment('recent', '2026-10-04T00:00:00.000Z')
const created = makeSegment('created', '2026-10-05T00:00:00.000Z')

// Newest page first; the older page's rows sort strictly before its cursor.
const twoPages = (): SegmentHistory => {
  const newest = makePage([boundary, recent], true)
  return {
    pages: [newest, makePage([oldest, old], true)],
    pageParams: [null, newest.nextCursor],
  }
}
const ids = (history: SegmentHistory | undefined) =>
  historySegments(history).map((s) => s.id)

describe('appendHistory', () => {
  it('appends a new row to the newest page and keeps older pages', () => {
    const history = twoPages()
    const result = appendHistory(history, created, false)
    expect(result.appended).toBe(true)
    expect(ids(result.history)).toEqual([
      'oldest',
      'old',
      'boundary',
      'recent',
      'created',
    ])
    expect(result.history!.pages[1]).toBe(history.pages[1])
    expect(result.history!.pageParams).toEqual(history.pageParams)
  })

  it('reports unloaded history as unknown', () => {
    expect(appendHistory(undefined, created, false)).toEqual({
      history: undefined,
      appended: null,
    })
    const empty: SegmentHistory = { pages: [], pageParams: [] }
    expect(appendHistory(empty, created, true)).toEqual({
      history: empty,
      appended: null,
    })
  })

  it('replaces a replayed row in place without appending it again', () => {
    const history = twoPages()
    const replay = { ...recent, targetText: 'refreshed' }
    const result = appendHistory(history, replay, false)
    expect(result.appended).toBe(false)
    expect(ids(result.history)).toEqual(ids(history))
    expect(result.history!.pages[0].segments[1]).toBe(replay)
  })

  it('replaces a loaded dedupe hit in its own older page', () => {
    const history = twoPages()
    const hit = { ...old, targetText: 'same row' }
    const result = appendHistory(history, hit, true)
    expect(result.appended).toBe(false)
    expect(ids(result.history)).toEqual(ids(history))
    expect(result.history!.pages[1].segments[1]).toBe(hit)
    expect(result.history!.pages[0]).toBe(history.pages[0])
  })

  it('leaves history untouched for a dedupe hit in an unloaded older page', () => {
    const history: SegmentHistory = {
      pages: [makePage([boundary, recent], true)],
      pageParams: [null],
    }
    const result = appendHistory(history, old, true)
    expect(result).toEqual({ history, appended: false })
    expect(result.history).toBe(history)
  })

  it('treats a millisecond tie with the microsecond cursor as unloaded', () => {
    const history: SegmentHistory = {
      pages: [
        {
          segments: [boundary, recent],
          nextCursor: {
            id: boundary.id,
            createdAt: '2026-02-01T00:00:00.000500Z',
          },
        },
      ],
      pageParams: [null],
    }
    const tie = makeSegment('tie', '2026-02-01T00:00:00.000Z')
    expect(appendHistory(history, tie, true).appended).toBe(false)
  })

  it('flags a missing dedupe hit inside the loaded range as stale', () => {
    // Another device created it after this history was read.
    const history: SegmentHistory = {
      pages: [makePage([boundary, recent], true)],
      pageParams: [null],
    }
    const elsewhere = makeSegment('elsewhere', '2026-10-04T12:00:00.000Z')
    expect(appendHistory(history, elsewhere, true)).toEqual({
      history,
      appended: null,
    })
    // With no older page, a missing row cannot live in an unloaded page.
    const complete: SegmentHistory = {
      pages: [makePage([boundary, recent])],
      pageParams: [null],
    }
    expect(appendHistory(complete, old, true)).toEqual({
      history: complete,
      appended: null,
    })
  })
})

describe('replaceHistory', () => {
  it('replaces a row in an older page and keeps neighbours and cursors', () => {
    const history = twoPages()
    const retried = { ...oldest, targetText: 'retried' }
    const next = replaceHistory(history, retried)!
    expect(next.pages[1].segments).toEqual([retried, old])
    expect(next.pages[1].segments[1]).toBe(old)
    expect(next.pages[1].nextCursor).toEqual(cursorOf(oldest))
    expect(next.pages[0]).toBe(history.pages[0])
    expect(next.pageParams).toEqual(history.pageParams)
    expect(ids(next)).toEqual(ids(history))
  })

  it('returns the same history when the id is not loaded', () => {
    const history = twoPages()
    expect(replaceHistory(history, created)).toBe(history)
  })

  it('leaves undefined history undefined', () => {
    expect(replaceHistory(undefined, created)).toBeUndefined()
  })
})
