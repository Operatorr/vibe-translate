import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  historySegments,
  replaceHistory,
  type SegmentPage,
  type SegmentCursor,
  type SegmentHistory,
} from '@/lib/segment-history'
import { bootstrapOptions, type AppBootstrap } from '@/lib/app-bootstrap'
import { scopedMutation } from '@/lib/scoped-mutation'
import type {
  QueryClient,
  QueryKey,
  UseMutationOptions,
} from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { authClient, useSignedIn } from '@/lib/auth-client'
import { applyServerThread, patchThread } from '@/lib/query-updaters'
import { keys } from '@/lib/query-keys'
import { createSegmentOptions } from '@/lib/segment-mutations'
import type {
  Character,
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

export function useCharacters(ready = true) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.characters,
    queryFn: ({ signal }) => call<Character[]>('/api/characters', { signal }),
    enabled: enabled && ready,
  })
}

export function useThreads(characterId: string | null) {
  const { call, enabled } = useApi()
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.threads(characterId),
    queryFn: async ({ signal }) => {
      const id = encodeURIComponent(characterId ?? '')
      // First visit: include the newest thread's first page so selecting it
      // never starts a second HTTP round trip. Refreshes read only the roster.
      if (!qc.getQueryData(keys.threads(characterId))) {
        const data = await call<AppBootstrap>(
          `/api/app/bootstrap?characterId=${id}`,
          { signal },
        )
        signal.throwIfAborted()
        if (data.characterId !== characterId) return []
        if (data.threadId && !qc.getQueryData(keys.segments(data.threadId)))
          qc.setQueryData<SegmentHistory>(keys.segments(data.threadId), {
            pages: [data.segmentPage],
            pageParams: [null],
          })
        return data.threads
      }
      return call<Thread[]>(`/api/threads?characterId=${id}`, { signal })
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
      qc.setQueryData<Character[]>(keys.characters, (prev) => [
        ...(prev ?? []),
        created,
      ])
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
        (list ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.characters, ctx.prev)
    },
    onSuccess: async (updated) => {
      if (!(await cancelOwnedQueries(qc, keys.characters))) return
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        (list ?? []).map((c) => (c.id === updated.id ? updated : c)),
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
      (input) => json<Segment>('/api/segments', 'POST', input),
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

export function useThreadShare(threadId: string | null, open = true) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.share(threadId ?? ''),
    queryFn: ({ signal }) =>
      call<ThreadShare>(`/api/threads/${threadId}/share`, { signal }),
    enabled: enabled && !!threadId && open,
    staleTime: 5 * 60_000,
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
