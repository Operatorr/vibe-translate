// @vitest-environment jsdom
import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useAppBootstrap,
  useCharacters,
  useMe,
  useSegments,
  useThreads,
} from '@/hooks/use-app-data'
import type { AppBootstrap, AppWorkspace } from '@/lib/app-bootstrap'
import { keys } from '@/lib/query-keys'
import type { Thread } from '@/lib/types'
import {
  makeCharacter,
  makeMe,
  makePage,
  makeSegment,
  makeThread,
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

function newClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
  clients.push(client)
  return client
}

// Routes every request through `respond`; plain values become JSON bodies.
function stubFetch(respond: (path: string) => unknown) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const body = respond(String(input))
    return body instanceof Response ? body : Response.json(body)
  })
  vi.stubGlobal('fetch', fetch)
  return () => fetch.mock.calls.map(([input]) => String(input))
}
const unavailable = () =>
  Response.json({ error: { message: 'down', status: 503 } }, { status: 503 })

function SharedConsumer({ ready }: { ready: boolean }) {
  const me = useMe(ready)
  const characters = useCharacters(ready)
  return (
    <span>
      {me.data?.displayName} {characters.data?.length}
    </span>
  )
}
function Product() {
  const bootstrap = useAppBootstrap(null)
  return (
    <>
      <SharedConsumer ready={!bootstrap.isFetching} />
      <SharedConsumer ready={!bootstrap.isFetching} />
    </>
  )
}

describe('product lifecycle work', () => {
  it('shares one bootstrap across StrictMode and nested consumers, and reuses domain data on return', async () => {
    const snapshot = {
      me: makeMe({ displayName: 'Fixture' }),
      characters: [makeCharacter('c')],
      characterId: 'c',
      threads: [],
      threadId: null,
      segmentPage: makePage([]),
    } satisfies AppBootstrap
    const paths = stubFetch(() => snapshot)
    const client = newClient()
    const mount = () =>
      render(
        <StrictMode>
          <QueryClientProvider client={client}>
            <Product />
          </QueryClientProvider>
        </StrictMode>,
      )
    const first = mount()
    await waitFor(() =>
      expect(screen.getAllByText('Fixture 1')).toHaveLength(2),
    )
    expect(paths()).toEqual(['/api/app/bootstrap'])
    first.unmount()
    mount()
    await waitFor(() =>
      expect(screen.getAllByText('Fixture 1')).toHaveLength(2),
    )
    expect(paths()).toHaveLength(1)
  })
})

function History({ threadId }: { threadId: string }) {
  const history = useSegments(threadId)
  return <span>History {history.data?.pages[0].segments.length}</span>
}
function Workspace({ characterId }: { characterId: string | null }) {
  const threads = useThreads(characterId)
  const first = threads.data?.[0]
  if (!first) return null
  return (
    <>
      <span>
        {first.title} of {threads.data?.length}
      </span>
      <History threadId={first.id} />
    </>
  )
}

describe('Character workspace reads', () => {
  it('loads a newly visited Character and its first history page once, then refreshes only the roster', async () => {
    const thread = makeThread('t2', 'c2', { title: 'Second', segmentCount: 1 })
    const workspace = {
      characterId: 'c2',
      threads: [thread],
      threadId: 't2',
      segmentPage: makePage([makeSegment('s2', '2026-10-01T00:00:00.000Z')]),
    } satisfies AppWorkspace
    const refreshed: Thread[] = [
      { ...thread, title: 'Renamed', segmentCount: 2 },
      makeThread('t3', 'c2'),
    ]
    const paths = stubFetch((path) =>
      path.startsWith('/api/app/workspace') ? workspace : refreshed,
    )
    const client = newClient()
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Workspace characterId="c2" />
          <Workspace characterId="c2" />
        </QueryClientProvider>
      </StrictMode>,
    )
    await waitFor(() =>
      expect(screen.getAllByText('History 1')).toHaveLength(2),
    )
    // The StrictMode-cancelled first read must not fall back to /api/threads.
    expect(paths()).toEqual(['/api/app/workspace?characterId=c2'])
    expect(screen.getAllByText('Second of 1')).toHaveLength(2)
    const history = client.getQueryData(keys.segments('t2'))

    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.threads('c2') })
    })
    expect(paths()).toEqual([
      '/api/app/workspace?characterId=c2',
      '/api/threads?characterId=c2',
    ])
    expect(await screen.findAllByText('Renamed of 2')).toHaveLength(2)
    expect(client.getQueryData(keys.threads('c2'))).toEqual(refreshed)
    expect(client.getQueryData(keys.segments('t2'))).toBe(history)
  })

  it('falls back to individual reads when the bootstrap and workspace snapshots fail', async () => {
    const character = makeCharacter('c1')
    const thread = makeThread('t1', 'c1', { title: 'Only', segmentCount: 2 })
    const page = makePage([
      makeSegment('s1', '2026-10-01T00:00:00.000Z'),
      makeSegment('s2', '2026-10-02T00:00:00.000Z'),
    ])
    const paths = stubFetch((path) => {
      if (path.startsWith('/api/app/')) return unavailable()
      if (path === '/api/users/me') return makeMe({ displayName: 'Fixture' })
      if (path === '/api/characters') return [character]
      if (path === '/api/threads?characterId=c1') return [thread]
      if (path === '/api/segments/page?threadId=t1') return page
      throw new Error(`unexpected ${path}`)
    })
    function Shell() {
      const bootstrap = useAppBootstrap('c1')
      const ready = !bootstrap.isFetching
      const me = useMe(ready)
      const characters = useCharacters(ready)
      const threads = useThreads(characters.data?.[0]?.id ?? null)
      const history = useSegments(threads.data?.[0]?.id ?? null)
      return (
        <span>
          {me.data?.displayName} with {characters.data?.length} /{' '}
          {threads.data?.length} / {history.data?.pages[0].segments.length}
        </span>
      )
    }
    const client = newClient()
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Shell />
        </QueryClientProvider>
      </StrictMode>,
    )
    await waitFor(() => screen.getByText('Fixture with 1 / 1 / 2'))
    expect([...paths()].sort()).toEqual([
      '/api/app/bootstrap?characterId=c1',
      '/api/app/workspace?characterId=c1',
      '/api/characters',
      '/api/segments/page?threadId=t1',
      '/api/threads?characterId=c1',
      '/api/users/me',
    ])
    expect(client.getQueryData(keys.threads('c1'))).toEqual([thread])
  })
})
