import type { QueryClient } from '@tanstack/react-query'

import { keys } from './query-keys'
import { touchThread } from './query-updaters'
import { appendHistory, type SegmentHistory } from './segment-history'
import type { Segment, Thread, VibeStop } from './types'

export type CreateSegmentInput = {
  threadId: string
  sourceText: string
  vibe?: VibeStop
}

// Shared by the hook and regression tests so they exercise the same cache flow.
export function createSegmentOptions(
  qc: QueryClient,
  create: (input: CreateSegmentInput) => Promise<Segment>,
  getOwner: () => unknown = () => null,
) {
  return {
    mutationFn: create,
    onMutate: async (vars: CreateSegmentInput) => {
      await qc.cancelQueries({ queryKey: keys.segments(vars.threadId) })
    },
    onSuccess: async (created: Segment, vars: CreateSegmentInput) => {
      const owner = getOwner()
      const key = keys.segments(vars.threadId)
      // A refetch may have started during the provider call. Cancel it before
      // merging the response so a pre-insert snapshot cannot erase the new row.
      await qc.cancelQueries({ queryKey: key })
      if (owner !== getOwner()) return
      let appended: boolean | null = null
      qc.setQueryData<SegmentHistory>(key, (prev) => {
        const result = appendHistory(prev, created)
        appended = result.appended
        return result.history
      })
      if (appended === true) {
        qc.setQueriesData<Thread[]>({ queryKey: ['threads'] }, (list) =>
          touchThread(list, vars.threadId, created.createdAt, 1),
        )
      } else if (appended === null) {
        void qc.invalidateQueries({ queryKey: ['threads'] })
        // No history was loaded: fetch a bounded page, not a partial list
        // containing only this response, and don't reuse the cancelled GET.
        await qc.invalidateQueries({ queryKey: key })
      }
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  }
}
