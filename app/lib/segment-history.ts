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

export function appendHistory(
  history: SegmentHistory | undefined,
  created: Segment,
) {
  if (!history?.pages.length) return { history, appended: null }
  if (
    history.pages.some((page) => page.segments.some((s) => s.id === created.id))
  )
    return { history, appended: false }
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

export function replaceHistory(
  history: SegmentHistory | undefined,
  updated: Segment,
) {
  return (
    history && {
      ...history,
      pages: history.pages.map((page) => ({
        ...page,
        segments: page.segments.map((s) => (s.id === updated.id ? updated : s)),
      })),
    }
  )
}
