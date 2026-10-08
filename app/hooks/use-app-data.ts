import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'
import {
  bootstrapOptions,
  seedFirstPage,
  type AppWorkspace,
} from '@/lib/app-bootstrap'
import { authClient, useSignedIn } from '@/lib/auth-client'
import { keys } from '@/lib/query-keys'
import {
  applyServerThread,
  patchThread,
  upsertCharacter,
} from '@/lib/query-updaters'
import { scopedMutation } from '@/lib/scoped-mutation'
import {
  historySegments,
  replaceHistory,
  type SegmentCursor,
  type SegmentHistory,
  type SegmentPage,
} from '@/lib/segment-history'
import { createSegmentOptions } from '@/lib/segment-mutations'
import type {
  Character,
  CreatedSegment,
  ExplainPayload,
  Me,
  Persona,
  Segment,
  Thread,
  ThreadShare,
  VibeStop,
} from '@/lib/types'

// Domain hooks for the authenticated app. Query keys are prefixed with the
// names persisted by app/lib/query-cache-store.ts ('characters', 'threads',
// 'segment-pages'), so list data survives reloads and works offline (read-only).

export { keys } from '@/lib/query-keys'

const mutationOwner = () => authClient.$store.atoms.session.get().data?.user.id

async function cancelOwnedQueries(qc: QueryClient, queryKey: QueryKey) {
  const owner = mutationOwner()
  await qc.cancelQueries({ queryKey })
  return owner === mutationOwner()
}

function useScopedMutation<TData, TVariables, TContext = unknown>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
) {
  return useMutation(scopedMutation(options, mutationOwner))
}

function useApi() {
  const isSignedIn = useSignedIn()
  const call = <T>(
    path: string,
    init?: RequestInit & { responseType?: 'json' | 'blob' },
  ) => apiFetch<T>(path, init)
  const json = <T>(path: string, method: string, body?: unknown) =>
    call<T>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { call, json, enabled: isSignedIn === true }
}

export function useAppBootstrap(characterId: string | null) {
  const { enabled } = useApi()
  const qc = useQueryClient()
  return useQuery({
    ...bootstrapOptions(qc, characterId),
    enabled: enabled && !qc.getQueryData(keys.characters),
  })
}

export function useMe(ready = true) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => call<Me>('/api/users/me', { signal }),
    enabled: enabled && ready,
    staleTime: 60_000,
  })
}

const charactersQuery = queryOptions({
  queryKey: keys.characters,
  queryFn: ({ signal }) => apiFetch<Character[]>('/api/characters', { signal }),
})

export function useCharacters(ready = true) {
  const { enabled } = useApi()
  return useQuery({ ...charactersQuery, enabled: enabled && ready })
}

export function useThreads(characterId: string | null) {
  const { call, enabled } = useApi()
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.threads(characterId),
    queryFn: async ({ signal }) => {
      const id = encodeURIComponent(characterId ?? '')
      const roster = () =>
        call<Thread[]>(`/api/threads?characterId=${id}`, { signal })
      // Refreshes read only the roster.
      if (qc.getQueryData(keys.threads(characterId))) return roster()
      // First visit: include the newest thread's first page so selecting it
      // never starts a second HTTP round trip.
      try {
        const data = await call<AppWorkspace>(
          `/api/app/workspace?characterId=${id}`,
          { signal },
        )
        signal.throwIfAborted()
        if (data.characterId !== characterId) return []
        seedFirstPage(qc, data)
        return data.threads
      } catch (error) {
        // The snapshot is an optimization: fall back to the plain roster and
        // let the selected Thread's useSegments load its own first page.
        if (signal.aborted) throw error
        return roster()
      }
    },
    enabled: enabled && !!characterId,
  })
}

export function useSegments(threadId: string | null) {
  const { call, enabled } = useApi()
  return useInfiniteQuery({
    queryKey: keys.segments(threadId),
    initialPageParam: null as SegmentCursor | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ threadId: threadId ?? '' })
      if (pageParam) {
        params.set('beforeCreatedAt', pageParam.createdAt)
        params.set('beforeId', pageParam.id)
      }
      return call<SegmentPage>(`/api/segments/page?${params}`, { signal })
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: enabled && !!threadId,
  })
}

export type CharacterInput = {
  name: string
  initials?: string
  color?: string
  sourceLanguage: string
  targetLanguage: string
  defaultVibe: VibeStop
  temperature: number
  persona: Persona
  instructions?: string
}

export function useCreateCharacter() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: (input: CharacterInput) =>
      json<Character>('/api/characters', 'POST', input),
    onSuccess: async (created) => {
      if (!(await cancelOwnedQueries(qc, keys.characters))) return
      const prev = qc.getQueryData<Character[]>(keys.characters)
      if (prev) {
        qc.setQueryData(keys.characters, upsertCharacter(prev, created))
        return
      }
      // Unloaded roster (bootstrap pending or the list failed): a one-row list
      // would be persisted and stop bootstrap seeding, hiding the rest. Fetch
      // the committed roster directly; a disabled observer won't refetch.
      void qc.prefetchQuery(charactersQuery)
    },
  })
}

export function useUpdateCharacter() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: ({ id, ...patch }: Partial<CharacterInput> & { id: string }) =>
      json<Character>(`/api/characters/${id}`, 'PATCH', patch),
    // Optimistic: the temperature slider PATCHes on release and should not
    // snap back while the request is in flight.
    onMutate: async ({ id, ...patch }) => {
      if (!(await cancelOwnedQueries(qc, keys.characters))) return
      const prev = qc.getQueryData<Character[]>(keys.characters)
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        // Unloaded roster: never persist an empty list in its place.
        list?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.characters, ctx.prev)
    },
    onSuccess: async (updated) => {
      if (!(await cancelOwnedQueries(qc, keys.characters))) return
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        list?.map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })
}

export function useDeleteCharacter() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: (id: string) =>
      json<{ ok: true }>(`/api/characters/${id}`, 'DELETE'),
    onSuccess: (_res, id) => {
      // The worker cascades threads → segments → shares; drop every cached
      // child too so persisted lists don't outlive their rows.
      for (const t of qc.getQueryData<Thread[]>(keys.threads(id)) ?? []) {
        for (const s of historySegments(
          qc.getQueryData<SegmentHistory>(keys.segments(t.id)),
        )) {
          qc.removeQueries({ queryKey: keys.explain(s.id) })
        }
        qc.removeQueries({ queryKey: keys.segments(t.id) })
        qc.removeQueries({ queryKey: keys.share(t.id) })
      }
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        list?.filter((c) => c.id !== id),
      )
      qc.removeQueries({ queryKey: keys.threads(id) })
    },
  })
}

export function useCreateThread() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: (input: { characterId: string; title: string }) =>
      json<Thread>('/api/threads', 'POST', input),
    onSuccess: (created) => {
      // Unloaded list: leave it to the fetch rather than persisting a partial one.
      qc.setQueryData<Thread[]>(
        keys.threads(created.characterId),
        (prev) => prev && [created, ...prev],
      )
    },
  })
}

export function useUpdateThread() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: ({
      id,
      characterId: _characterId,
      ...patch
    }: {
      id: string
      characterId: string
      title?: string
      archived?: boolean
      starred?: boolean
    }) => json<Thread>(`/api/threads/${id}`, 'PATCH', patch),
    onMutate: async ({ id, characterId, ...patch }) => {
      const key = keys.threads(characterId)
      if (!(await cancelOwnedQueries(qc, key))) return
      const prev = qc.getQueryData<Thread[]>(key)
      qc.setQueryData<Thread[]>(key, (list) => patchThread(list, id, patch))
      return { prev, key }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev)
    },
    onSuccess: (updated, vars) => {
      qc.setQueryData<Thread[]>(keys.threads(vars.characterId), (list) =>
        applyServerThread(list, updated),
      )
      if (updated.archivedAt != null) {
        // Archived threads leave the UI; don't keep (or persist) their children.
        qc.removeQueries({ queryKey: keys.segments(updated.id) })
        qc.removeQueries({ queryKey: keys.share(updated.id) })
      }
    },
  })
}

export function useDeleteThread() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: ({ id }: { id: string; characterId: string }) =>
      json<{ ok: true }>(`/api/threads/${id}`, 'DELETE'),
    onSuccess: (_res, { id, characterId }) => {
      qc.setQueryData<Thread[]>(keys.threads(characterId), (list) =>
        list?.filter((t) => t.id !== id),
      )
      qc.removeQueries({ queryKey: keys.segments(id) })
      qc.removeQueries({ queryKey: keys.share(id) })
    },
  })
}

export function useCreateSegment() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation(
    createSegmentOptions(
      qc,
      (input) => json<CreatedSegment>('/api/segments', 'POST', input),
      mutationOwner,
    ),
  )
}

export function useRetrySegment() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: ({ id }: { id: string; threadId: string }) =>
      json<Segment>(`/api/segments/${id}/retry`, 'POST'),
    // A GET that started before the retry would land afterwards with the old
    // target and overwrite the fresh one.
    onMutate: async ({ threadId }) => {
      await qc.cancelQueries({ queryKey: keys.segments(threadId) })
    },
    onSuccess: async (updated, vars) => {
      const key = keys.segments(vars.threadId)
      if (!(await cancelOwnedQueries(qc, key))) return
      if (qc.getQueryData<SegmentHistory>(key)) {
        qc.setQueryData<SegmentHistory>(key, (history) =>
          replaceHistory(history, updated),
        )
      } else {
        // Never write an empty/partial list for an unloaded (or just-cancelled) query.
        void qc.invalidateQueries({ queryKey: key })
      }
      qc.removeQueries({ queryKey: keys.explain(updated.id) })
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useExplain(segmentId: string | null, enabled: boolean) {
  const { call, enabled: signedIn } = useApi()
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.explain(segmentId ?? ''),
    queryFn: async () => {
      const payload = await call<ExplainPayload>(
        `/api/segments/${segmentId}/explain`,
      )
      // A generated (uncached) Explain spends credits.
      if (payload.cached === false)
        void qc.invalidateQueries({ queryKey: keys.me })
      return payload
    },
    enabled: signedIn && enabled && !!segmentId,
    staleTime: Infinity,
    retry: false,
  })
}

// Shared by the Share popover and Markdown export, so both read one entry.
export const shareQuery = (threadId: string) =>
  queryOptions({
    queryKey: keys.share(threadId),
    queryFn: ({ signal }) =>
      apiFetch<ThreadShare>(`/api/threads/${threadId}/share`, { signal }),
    staleTime: 5 * 60_000,
  })

export function useThreadShare(threadId: string | null, open = true) {
  const { enabled } = useApi()
  return useQuery({
    ...shareQuery(threadId ?? ''),
    enabled: enabled && !!threadId && open,
  })
}

export function useSetThreadShare() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: ({ threadId, shared }: { threadId: string; shared: boolean }) =>
      json<ThreadShare>(
        `/api/threads/${threadId}/share`,
        shared ? 'POST' : 'DELETE',
      ),
    onMutate: ({ threadId }) =>
      qc.cancelQueries({ queryKey: keys.share(threadId) }),
    onSuccess: async (res, { threadId }) => {
      if (!(await cancelOwnedQueries(qc, keys.share(threadId)))) return
      qc.setQueryData(keys.share(threadId), res)
    },
  })
}

export function useUpdateMe() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useScopedMutation({
    mutationFn: (patch: {
      displayName?: string
      onboardingComplete?: boolean
    }) => json<{ ok: true; user: Me }>('/api/users/me', 'PATCH', patch),
    onSuccess: (res) => qc.setQueryData(keys.me, res.user),
  })
}

// Binary fetch for ElevenLabs audio. Throws ApiError on 4xx/5xx so callers can
// fall back to browser speech synthesis; `signal` cancels a stopped utterance.
export function useTtsFetch() {
  const { call } = useApi()
  return (
    input: { text: string; vibe: VibeStop; languageCode: string },
    options?: { signal?: AbortSignal },
  ) =>
    call<Blob>('/api/ai/text-to-speech', {
      method: 'POST',
      body: JSON.stringify(input),
      responseType: 'blob',
      signal: options?.signal,
    })
}
