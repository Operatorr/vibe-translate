import type { QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { keys } from './query-keys'
import type { SegmentPage, SegmentHistory } from './segment-history'
import type { Character, Me, Thread } from './types'

export type AppBootstrap = {
  me: Me
  characters: Character[]
  threads: Thread[]
  characterId: string | null
  threadId: string | null
  segmentPage: SegmentPage
}

// This query is only a transport boundary. Query owns each domain's freshness
// and mutations; do not keep a second route snapshot that can resurrect old rows.
export function bootstrapOptions(
  client: QueryClient,
  characterId: string | null,
) {
  return {
    queryKey: ['app-bootstrap'] as const,
    staleTime: 0,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const params = characterId
        ? `?characterId=${encodeURIComponent(characterId)}`
        : ''
      const data = await apiFetch<AppBootstrap>(`/api/app/bootstrap${params}`, {
        signal,
      })
      signal.throwIfAborted()
      // Never replace newer hydrated or independently loaded domain data.
      if (!client.getQueryData(keys.me)) client.setQueryData(keys.me, data.me)
      if (!client.getQueryData(keys.characters))
        client.setQueryData(keys.characters, data.characters)
      if (
        data.characterId &&
        !client.getQueryData(keys.threads(data.characterId))
      )
        client.setQueryData(keys.threads(data.characterId), data.threads)
      if (data.threadId && !client.getQueryData(keys.segments(data.threadId)))
        client.setQueryData<SegmentHistory>(keys.segments(data.threadId), {
          pages: [data.segmentPage],
          pageParams: [null],
        })
      return data
    },
  }
}
