// @vitest-environment jsdom
import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { keys } from '@/lib/query-keys'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useAppBootstrap,
  useCharacters,
  useMe,
  useThreads,
  useSegments,
} from '@/hooks/use-app-data'

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
    const fetch = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        me: { displayName: 'Fixture' },
        characters: [{ id: 'c' }],
        threads: [],
        characterId: 'c',
        threadId: null,
        segmentPage: { segments: [], nextCursor: null },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    })
    clients.push(client)
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
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/app/bootstrap')
    first.unmount()
    mount()
    await waitFor(() =>
      expect(screen.getAllByText('Fixture 1')).toHaveLength(2),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

function History({ threadId }: { threadId: string }) {
  const history = useSegments(threadId)
  return <span>History {history.data?.pages[0].segments.length}</span>
}
function Workspace() {
  const threads = useThreads('c2')
  return threads.data?.[0] ? <History threadId={threads.data[0].id} /> : null
}
it('loads a newly visited Character and its first history page once, then refreshes only the roster', async () => {
  const thread = { id: 't2', characterId: 'c2', title: 'Second workspace' }
  const fetch = vi.fn(async (path: RequestInfo | URL) =>
    Response.json(
      String(path).startsWith('/api/app/bootstrap')
        ? {
            me: {},
            characters: [],
            threads: [thread],
            characterId: 'c2',
            threadId: 't2',
            segmentPage: { segments: [{ id: 's2' }], nextCursor: null },
          }
        : [thread],
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  })
  clients.push(client)
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Workspace />
        <Workspace />
      </QueryClientProvider>
    </StrictMode>,
  )
  await waitFor(() => expect(screen.getAllByText('History 1')).toHaveLength(2))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/app/bootstrap?characterId=c2')
  await act(async () => {
    await client.invalidateQueries({ queryKey: keys.threads('c2') })
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][0]).toBe('/api/threads?characterId=c2')
})
