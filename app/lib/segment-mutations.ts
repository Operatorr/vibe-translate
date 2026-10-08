import type { QueryClient } from '@tanstack/react-query'

import { keys } from './query-keys'
import { touchThread } from './query-updaters'
import { appendHistory, type SegmentHistory } from './segment-history'
import type { CreatedSegment, Thread, VibeStop } from './types'

export type CreateSegmentInput = {
  threadId: string
  sourceText: string
  vibe?: VibeStop
}

// Shared by the hook and regression tests so they exercise the same cache flow.
// The mutation resolves with `reused` for the UI; the cache stores a Segment.
export function createSegmentOptions(
  qc: QueryClient,
  create: (input: CreateSegmentInput) => Promise<CreatedSegment>,
  getOwner: () => unknown = () => null,
) {
  return {
    mutationFn: create,
    onMutate: async (vars: CreateSegmentInput) => {
      await qc.cancelQueries({ queryKey: keys.segments(vars.threadId) })
    },
    onSuccess: async (created: CreatedSegment, vars: CreateSegmentInput) => {
      const { reused, ...segment } = created
      const owner = getOwner()
      const key = keys.segments(vars.threadId)
      // A refetch may have started during the provider call. Cancel it before
      // merging the response so a pre-insert snapshot cannot erase the new row.
      await qc.cancelQueries({ queryKey: key })
      if (owner !== getOwner()) return
      let appended: boolean | null = null
      qc.setQueryData<SegmentHistory>(key, (prev) => {
        const result = appendHistory(prev, segment, reused)
        appended = result.appended
        return result.history
      })
      if (appended === true) {
        qc.setQueriesData<Thread[]>({ queryKey: ['threads'] }, (list) =>
          touchThread(list, vars.threadId, segment.createdAt, 1),
        )
      } else if (appended === null) {
        void qc.invalidateQueries({ queryKey: ['threads'] })
        // History is unloaded or stale: fetch bounded pages, not a partial list
        // containing only this response, and don't reuse the cancelled GET.
        await qc.invalidateQueries({ queryKey: key })
      }
      // A dedupe hit spends no credits.
      if (!reused) void qc.invalidateQueries({ queryKey: keys.me })
    },
  }
}
