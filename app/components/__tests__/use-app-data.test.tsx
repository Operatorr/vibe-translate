// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useAppBootstrap,
  useCharacters,
  useCreateCharacter,
  type CharacterInput,
} from '@/hooks/use-app-data'
import type { AppBootstrap } from '@/lib/app-bootstrap'
import { keys } from '@/lib/query-keys'
import type { Character } from '@/lib/types'
import {
  deferred,
  makeCharacter,
  makeMe,
  makePage,
} from '@/lib/__tests__/test-fixtures'

vi.mock('@/lib/auth-client', () => ({
  useSignedIn: () => true,
  authClient: {
    $store: {
      atoms: { session: { get: () => ({ data: { user: { id: 'a' } } }) } },
    },
  },
}))
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((c) => c.clear())
  vi.unstubAllGlobals()
})

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false },
      mutations: { retry: false },
    },
  })
  clients.push(client)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

// `respond` sees "METHOD path"; plain values become JSON bodies.
function stubFetch(respond: (request: string) => unknown) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = await respond(`${init?.method ?? 'GET'} ${String(input)}`)
    return body instanceof Response ? body : Response.json(body)
  })
  vi.stubGlobal('fetch', fetch)
  return () =>
    fetch.mock.calls.map(
      ([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`,
    )
}

const input: CharacterInput = {
  name: 'Created',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  defaultVibe: 'casual',
  temperature: 0.4,
  persona: { traits: [] },
}
const existing = makeCharacter('a')
const created = makeCharacter('c', { name: 'Created', sortOrder: 1 })
const ids = (list: Character[] | undefined) => list?.map((c) => c.id)

describe('useCreateCharacter roster reconciliation', () => {
  it('appends to a loaded roster without refetching it', async () => {
    const requests = stubFetch(() => created)
    const { client, wrapper } = setup()
    client.setQueryData(keys.characters, [existing])
    const { result } = renderHook(() => useCreateCharacter(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(client.getQueryData(keys.characters)).toEqual([existing, created])
    expect(requests()).toEqual(['POST /api/characters'])
  })

  it('replaces a returned Character the roster already holds', async () => {
    // A roster refresh landed the committed row before the POST response.
    const committed = { ...created, name: 'Created (refreshed)' }
    const requests = stubFetch(() => created)
    const { client, wrapper } = setup()
    client.setQueryData(keys.characters, [existing, committed])
    const { result } = renderHook(() => useCreateCharacter(), { wrapper })
    await act(() => result.current.mutateAsync(input))
    expect(client.getQueryData(keys.characters)).toEqual([existing, created])
    expect(requests()).toEqual(['POST /api/characters'])
  })

  it('refetches a roster that bootstrap has not seeded yet', async () => {
    const snapshot = deferred<AppBootstrap>()
    const roster = deferred<Character[]>()
    const requests = stubFetch((request) => {
      if (request.startsWith('GET /api/app/bootstrap')) return snapshot.promise
      if (request === 'POST /api/characters') return created
      if (request === 'GET /api/characters') return roster.promise
      throw new Error(`unexpected ${request}`)
    })
    const { client, wrapper } = setup()
    const { result } = renderHook(
      () => {
        const bootstrap = useAppBootstrap(null)
        useCharacters(!bootstrap.isFetching)
        return { bootstrap, create: useCreateCharacter() }
      },
      { wrapper },
    )
    await waitFor(() => expect(requests()).toHaveLength(1))
    await act(() => result.current.create.mutateAsync(input))
    // No fabricated one-row roster for bootstrap to defer to.
    expect(client.getQueryData(keys.characters)).toBeUndefined()

    // A snapshot taken before the insert lands first...
    await act(async () => {
      snapshot.resolve({
        me: makeMe(),
        characters: [existing],
        characterId: 'a',
        threads: [],
        threadId: null,
        segmentPage: makePage([]),
      })
    })
    await waitFor(() => expect(result.current.bootstrap.isFetching).toBe(false))
    // ...and the committed roster replaces it.
    await act(async () => roster.resolve([existing, created]))
    await waitFor(() =>
      expect(ids(client.getQueryData(keys.characters))).toEqual(['a', 'c']),
    )
    expect(requests()).toEqual([
      'GET /api/app/bootstrap',
      'POST /api/characters',
      'GET /api/characters',
    ])
  })

  it('refetches a roster whose read failed', async () => {
    let reads = 0
    const requests = stubFetch((request) => {
      if (request === 'POST /api/characters') return created
      return ++reads === 1
        ? Response.json({ error: { message: 'down' } }, { status: 503 })
        : [existing, created]
    })
    const { client, wrapper } = setup()
    const { result } = renderHook(
      () => ({ characters: useCharacters(), create: useCreateCharacter() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.characters.isError).toBe(true))
    await act(() => result.current.create.mutateAsync(input))
    await waitFor(() =>
      expect(result.current.characters.data).toEqual([existing, created]),
    )
    expect(client.getQueryData(keys.characters)).toEqual([existing, created])
    expect(requests()).toEqual([
      'GET /api/characters',
      'POST /api/characters',
      'GET /api/characters',
    ])
  })
})
