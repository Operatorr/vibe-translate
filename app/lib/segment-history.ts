import type { InfiniteData } from '@tanstack/react-query'
import type { Segment } from './types'

export type SegmentCursor = { createdAt: string; id: string }
export type SegmentPage = {
  segments: Segment[]
  nextCursor: SegmentCursor | null
}
export type SegmentHistory = InfiniteData<SegmentPage>

export function historySegments(
  history: SegmentHistory | undefined,
): Segment[] {
  return history
    ? [...history.pages].reverse().flatMap((page) => page.segments)
    : []
}

/**
 * How a create response merged into loaded history; callers key Thread count
 * and refetch decisions off `appended`:
 * - `true`: a new row was appended to the newest page. Bump the Thread's count
 *   and recency.
 * - `false`: already accounted for. The row was loaded (replay, or a dedupe
 *   hit) and was replaced in place, or it is a dedupe hit older than the
 *   oldest loaded cursor and stays in its unloaded page. No count change.
 * - `null`: loaded history can't place the row. Nothing is loaded, or a dedupe
 *   hit is missing but can't be in an unloaded page (no older page exists, or
 *   it sorts after the oldest loaded cursor), so the history is stale, e.g.
 *   another device created it. Refetch rather than fabricate a partial or
 *   misordered page.
 */
export type AppendResult = {
  history: SegmentHistory | undefined
  appended: boolean | null
}

export function appendHistory(
  history: SegmentHistory | undefined,
  created: Segment,
  reused: boolean,
): AppendResult {
  if (!history?.pages.length) return { history, appended: null }
  if (history.pages.some((page) => hasSegment(page, created.id)))
    return { history: replaceHistory(history, created), appended: false }
  if (reused)
    return {
      history,
      appended: beforeLoadedHistory(history, created) ? false : null,
    }
  return {
    history: {
      ...history,
      pages: history.pages.map((page, i) =>
        i === 0 ? { ...page, segments: [...page.segments, created] } : page,
      ),
    },
    appended: true,
  }
}

// Pages without the row keep their identity, so only its page re-renders.
export function replaceHistory(
  history: SegmentHistory | undefined,
  updated: Segment,
): SegmentHistory | undefined {
  if (!history?.pages.some((page) => hasSegment(page, updated.id)))
    return history
  return {
    ...history,
    pages: history.pages.map((page) =>
      hasSegment(page, updated.id)
        ? {
            ...page,
            segments: page.segments.map((s) =>
              s.id === updated.id ? updated : s,
            ),
          }
        : page,
    ),
  }
}

function hasSegment(page: SegmentPage, id: string) {
  return page.segments.some((s) => s.id === id)
}

// Unloaded rows sort strictly before the oldest page's cursor. Segment
// timestamps are milliseconds while cursors carry microseconds, so a tie
// counts as unloaded.
function beforeLoadedHistory(history: SegmentHistory, segment: Segment) {
  const cursor = history.pages.at(-1)?.nextCursor
  return (
    !!cursor && Date.parse(segment.createdAt) <= Date.parse(cursor.createdAt)
  )
}
