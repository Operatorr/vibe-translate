import { useAuth } from '@clerk/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'
import {
  appendSegment,
  applyServerThread,
  patchThread,
  touchThread,
} from '@/lib/query-updaters'
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
// names persisted by app/lib/query-cache-persist.tsx ('characters', 'threads',
// 'segments'), so list data survives reloads and works offline (read-only).

export const keys = {
  me: ['me'] as const,
  characters: ['characters'] as const,
  threads: (characterId: string | null) => ['threads', characterId] as const,
  segments: (threadId: string | null) => ['segments', threadId] as const,
  explain: (segmentId: string) => ['explain', segmentId] as const,
  share: (threadId: string) => ['share', threadId] as const,
}

function useApi() {
  const { getToken, isSignedIn } = useAuth()
  const call = <T>(
    path: string,
    init?: RequestInit & { responseType?: 'json' | 'blob' },
  ) => apiFetch<T>(path, { ...init, getToken })
  const json = <T>(path: string, method: string, body?: unknown) =>
    call<T>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { call, json, enabled: isSignedIn === true }
}

export function useMe() {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.me,
    queryFn: () => call<Me>('/api/users/me'),
    enabled,
    staleTime: 60_000,
  })
}

export function useCharacters() {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.characters,
    queryFn: () => call<Character[]>('/api/characters'),
    enabled,
  })
}

export function useThreads(characterId: string | null) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.threads(characterId),
    queryFn: () =>
      call<Thread[]>(
        `/api/threads?characterId=${encodeURIComponent(characterId ?? '')}`,
      ),
    enabled: enabled && !!characterId,
  })
}

export function useSegments(threadId: string | null) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.segments(threadId),
    queryFn: () =>
      call<Segment[]>(
        `/api/segments?threadId=${encodeURIComponent(threadId ?? '')}`,
      ),
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
  return useMutation({
    mutationFn: (input: CharacterInput) =>
      json<Character>('/api/characters', 'POST', input),
    onSuccess: (created) => {
      qc.setQueryData<Character[]>(keys.characters, (prev) => [
        ...(prev ?? []),
        created,
      ])
      void qc.invalidateQueries({ queryKey: keys.characters })
    },
  })
}

export function useUpdateCharacter() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<CharacterInput> & { id: string }) =>
      json<Character>(`/api/characters/${id}`, 'PATCH', patch),
    // Optimistic: the temperature slider PATCHes on release and should not
    // snap back while the request is in flight.
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: keys.characters })
      const prev = qc.getQueryData<Character[]>(keys.characters)
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        (list ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.characters, ctx.prev)
    },
    onSuccess: (updated) => {
      qc.setQueryData<Character[]>(keys.characters, (list) =>
        (list ?? []).map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })
}

export function useDeleteCharacter() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      json<{ ok: true }>(`/api/characters/${id}`, 'DELETE'),
    onSuccess: (_res, id) => {
      // The worker cascades threads → segments → shares; drop every cached
      // child too so persisted lists don't outlive their rows.
      for (const t of qc.getQueryData<Thread[]>(keys.threads(id)) ?? []) {
        for (const s of qc.getQueryData<Segment[]>(keys.segments(t.id)) ?? []) {
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
  return useMutation({
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
  return useMutation({
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
      await qc.cancelQueries({ queryKey: key })
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
  return useMutation({
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
  return useMutation({
    mutationFn: (input: {
      threadId: string
      sourceText: string
      vibe?: VibeStop
    }) => json<Segment>('/api/segments', 'POST', input),
    onSuccess: (created, vars, _ctx) => {
      let appended: boolean | null = null
      qc.setQueryData<Segment[]>(keys.segments(vars.threadId), (prev) => {
        const result = appendSegment(prev, created)
        appended = result.appended
        return result.list
      })
      if (appended === true) {
        // Bump the thread's count/recency without a refetch.
        qc.setQueriesData<Thread[]>({ queryKey: ['threads'] }, (list) =>
          touchThread(list, vars.threadId, created.createdAt, 1),
        )
      } else if (appended === null) {
        // Segments weren't loaded, so we can't tell a new row from a de-duped one.
        void qc.invalidateQueries({ queryKey: ['threads'] })
      }
      // A miss spends credits; refresh the balance shown in the sidebar.
      void qc.invalidateQueries({ queryKey: keys.me })
    },
  })
}

export function useRetrySegment() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; threadId: string }) =>
      json<Segment>(`/api/segments/${id}/retry`, 'POST'),
    // A GET that started before the retry would land afterwards with the old
    // target and overwrite the fresh one.
    onMutate: async ({ threadId }) => {
      await qc.cancelQueries({ queryKey: keys.segments(threadId) })
    },
    onSuccess: (updated, vars) => {
      const key = keys.segments(vars.threadId)
      if (qc.getQueryData<Segment[]>(key)) {
        qc.setQueryData<Segment[]>(key, (list) =>
          list?.map((s) => (s.id === updated.id ? updated : s)),
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

export function useThreadShare(threadId: string | null) {
  const { call, enabled } = useApi()
  return useQuery({
    queryKey: keys.share(threadId ?? ''),
    queryFn: () => call<ThreadShare>(`/api/threads/${threadId}/share`),
    enabled: enabled && !!threadId,
    staleTime: 5 * 60_000,
  })
}

export function useSetThreadShare() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ threadId, shared }: { threadId: string; shared: boolean }) =>
      json<ThreadShare>(
        `/api/threads/${threadId}/share`,
        shared ? 'POST' : 'DELETE',
      ),
    onSuccess: (res, { threadId }) =>
      qc.setQueryData(keys.share(threadId), res),
  })
}

export function useUpdateMe() {
  const { json } = useApi()
  const qc = useQueryClient()
  return useMutation({
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
