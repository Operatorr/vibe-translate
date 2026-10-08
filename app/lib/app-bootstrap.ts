import type { QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { keys } from './query-keys'
import type { SegmentPage, SegmentHistory } from './segment-history'
import type { Character, Me, Thread } from './types'

// GET /api/app/workspace: one Character's Threads plus the newest Thread's
// first Segment page. `characterId` is null when the Character isn't usable.
export type AppWorkspace = {
  characterId: string | null
  threads: Thread[]
  threadId: string | null
  segmentPage: SegmentPage
}

// GET /api/app/bootstrap: the workspace plus the account-wide reads.
export type AppBootstrap = AppWorkspace & {
  me: Me
  characters: Character[]
}

// Seed the selected Thread's first page only when its history is missing; a
// loaded history may hold newer rows or older pages the snapshot lacks.
export function seedFirstPage(client: QueryClient, data: AppWorkspace) {
  if (data.threadId && !client.getQueryData(keys.segments(data.threadId)))
    client.setQueryData<SegmentHistory>(keys.segments(data.threadId), {
      pages: [data.segmentPage],
      pageParams: [null],
    })
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
      seedFirstPage(client, data)
      return data
    },
  }
}
