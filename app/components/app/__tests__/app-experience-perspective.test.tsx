// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppExperience } from '@/components/app/app-experience'
import { keys } from '@/lib/query-keys'
import type { SegmentHistory } from '@/lib/segment-history'
import type { Character, CreatedSegment, Segment } from '@/lib/types'
import {
  deferred,
  makeCharacter,
  makeMe,
  makePage,
  makeSegment,
  makeThread,
} from '@/lib/__tests__/test-fixtures'

const mocks = vi.hoisted(() => {
  const session = {
    data: { user: { id: 'u1', name: 'Learner', email: 'u1@example.com' } },
    isPending: false,
    error: null,
  }
  return {
    session,
    toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
  }
})

vi.mock('@/lib/auth-client', () => ({
  useSignedIn: () => true,
  signOut: vi.fn(),
  authClient: {
    useSession: () => mocks.session,
    $store: { atoms: { session: { get: () => mocks.session } } },
  },
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))

const aiko = makeCharacter('a', { name: 'Aiko', perspective: 'to' })
const botan = makeCharacter('b', { name: 'Botan', perspective: 'to' })
// Cached offline before Perspective existed: no field at all.
const { perspective: _dropped, ...legacyFields } = makeCharacter('c', {
  name: 'Chiyo',
})
const legacy = legacyFields as Character

type Call = {
  method: string
  path: string
  body: Record<string, unknown> | undefined
  reply: (response: Response) => void
}

// PATCH /api/characters/:id and POST /api/segments(/:id/retry) wait on the
// test; the account refresh after a translation answers straight away.
function stubFetch() {
  const calls: Call[] = []
  const unexpected: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const path = String(input)
      if (method === 'GET' && path === '/api/users/me')
        return Response.json(makeMe({ id: 'u1' }))
      if (
        (method === 'PATCH' && path.startsWith('/api/characters/')) ||
        (method === 'POST' && path.startsWith('/api/segments'))
      ) {
        const response = deferred<Response>()
        calls.push({
          method,
          path,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          reply: response.resolve,
        })
        return response.promise
      }
      unexpected.push(`${method} ${path}`)
      throw new Error(`Unexpected request: ${method} ${path}`)
    }),
  )
  const patches = () => calls.filter((c) => c.method === 'PATCH')
  const posts = () => calls.filter((c) => c.method === 'POST')
  return { patches, posts, unexpected }
}

const failure = () =>
  Response.json({ error: { message: 'down' } }, { status: 503 })

function renderApp(roster: Character[], segments: Segment[] = []) {
  const qc = new QueryClient({
    defaultOptions: {
      // Seeded data stays fresh: the only traffic is what the test drives.
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  qc.setQueryData(keys.me, makeMe({ id: 'u1' }))
  qc.setQueryData(keys.characters, roster)
  for (const c of roster) {
    qc.setQueryData(keys.threads(c.id), [makeThread(`t-${c.id}`, c.id)])
    qc.setQueryData<SegmentHistory>(keys.segments(`t-${c.id}`), {
      pages: [makePage(segments.filter((s) => s.threadId === `t-${c.id}`))],
      pageParams: [null],
    })
  }
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'app',
    component: AppExperience,
  })
  const creditsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'app/credits',
    component: () => <h1>Credits</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute, creditsRoute]),
    history: createMemoryHistory({ initialEntries: ['/app'] }),
  })
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const cached = (id: string) =>
    qc.getQueryData<Character[]>(keys.characters)?.find((c) => c.id === id)
  return { qc, cached }
}

const radio = (name: 'As the Character' | 'To the Character') =>
  screen.getByRole('radio', { name }) as HTMLInputElement

function expectRadio(value: 'as' | 'to') {
  expect(radio('As the Character').checked).toBe(value === 'as')
  expect(radio('To the Character').checked).toBe(value === 'to')
}

// The radios live in the composer's settings drawer, hidden until opened.
async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: /^Translation settings/ }),
  )
  return radio('To the Character')
}

const selectCharacter = (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => user.click(screen.getByRole('button', { name: new RegExp(name) }))

const pendingCard = () => document.querySelector('.segment--pending')

// Lets queued mutations and fetches run without resolving anything.
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })

let qcs: QueryClient[] = []
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  qcs.forEach((qc) => qc.clear())
  qcs = []
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup(roster: Character[], segments?: Segment[]) {
  const fetch = stubFetch()
  const app = renderApp(roster, segments)
  qcs.push(app.qc)
  return { ...fetch, ...app, user: userEvent.setup() }
}

describe('AppExperience perspective radio', () => {
  it('translates with the perspective shown at send, while its save is still pending', async () => {
    const { user, patches, posts, unexpected } = setup([aiko])
    await openSettings(user)
    expectRadio('to')

    await user.click(radio('As the Character'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ perspective: 'as' })

    await user.type(screen.getByRole('textbox'), 'Thank you for dinner')
    await user.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({
      threadId: 't-a',
      sourceText: 'Thank you for dinner',
      perspective: 'as',
    })
    expect(pendingCard()?.textContent).toContain('as Character')

    // The save lands while the translation is still running.
    await act(async () =>
      patches()[0].reply(Response.json({ ...aiko, perspective: 'as' })),
    )
    await settle()
    expectRadio('as')
    expect(pendingCard()?.textContent).toContain('as Character')

    // Flipping the radio now changes the next send, not this one.
    await user.click(radio('To the Character'))
    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(pendingCard()?.textContent).toContain('as Character')
    expect(pendingCard()?.textContent).not.toContain('to Character')
    expect(posts()).toHaveLength(1)

    await act(async () => {
      patches()[1].reply(Response.json({ ...aiko, perspective: 'to' }))
      const created: CreatedSegment = {
        ...makeSegment('s1', '2026-10-01T00:00:00.000Z', {
          threadId: 't-a',
          sourceText: 'Thank you for dinner',
          perspective: 'as',
        }),
        reused: false,
      }
      posts()[0].reply(Response.json(created))
    })
    await waitFor(() => expect(pendingCard()).toBeNull())
    expect(screen.getByText(/as Character/)).toBeTruthy()
    expectRadio('to')
    expect(unexpected).toEqual([])
  })

  it('returns the radio to the saved value when the save fails', async () => {
    const { user, patches, cached, unexpected } = setup([aiko])
    await openSettings(user)

    await user.click(radio('As the Character'))
    expectRadio('as')
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(cached('a')?.perspective).toBe('as')

    await act(async () => patches()[0].reply(failure()))
    await waitFor(() => expectRadio('to'))
    expect(cached('a')?.perspective).toBe('to')
    expect(mocks.toast.error).toHaveBeenCalled()
    expect(unexpected).toEqual([])
  })

  it('rolls back only the failed Character, not one changed since', async () => {
    const { user, patches, cached, unexpected } = setup([aiko, botan])
    await openSettings(user)

    await user.click(radio('As the Character'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    await selectCharacter(user, 'Botan')
    await waitFor(() => expectRadio('to'))
    await user.click(radio('As the Character'))
    expectRadio('as')

    await act(async () => patches()[0].reply(failure()))
    await settle()
    expect(mocks.toast.error).toHaveBeenCalled()
    expect(cached('a')?.perspective).toBe('to')
    // Botan's newer choice survives Aiko's failure.
    expectRadio('as')
    expect(cached('b')?.perspective).toBe('as')

    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1].path).toBe('/api/characters/b')
    await act(async () =>
      patches()[1].reply(Response.json({ ...botan, perspective: 'as' })),
    )
    await settle()
    expectRadio('as')

    await selectCharacter(user, 'Aiko')
    await waitFor(() => expectRadio('to'))
    expect(unexpected).toEqual([])
  })

  it('shows each Character’s own saved perspective when switching', async () => {
    const { user, patches, cached, unexpected } = setup([aiko, botan])
    await openSettings(user)
    expectRadio('to')

    await user.click(radio('As the Character'))
    await waitFor(() => expect(patches()).toHaveLength(1))

    // Switch while Aiko's save is still in flight.
    await selectCharacter(user, 'Botan')
    await waitFor(() => expectRadio('to'))

    await act(async () =>
      patches()[0].reply(Response.json({ ...aiko, perspective: 'as' })),
    )
    await settle()
    expectRadio('to')
    expect(cached('a')?.perspective).toBe('as')
    expect(cached('b')?.perspective).toBe('to')

    await selectCharacter(user, 'Aiko')
    await waitFor(() => expectRadio('as'))
    expect(patches()).toHaveLength(1)
    expect(unexpected).toEqual([])
  })

  it('stays on the last choice when quick saves answer in order', async () => {
    const { user, patches, cached, unexpected } = setup([aiko])
    await openSettings(user)

    await user.click(radio('As the Character'))
    await user.click(radio('To the Character'))
    expectRadio('to')
    await settle()
    // Queued, not raced: the second save waits for the first.
    expect(patches().map((p) => p.body)).toEqual([{ perspective: 'as' }])
    expectRadio('to')

    await act(async () =>
      patches()[0].reply(Response.json({ ...aiko, perspective: 'as' })),
    )
    await settle()
    expectRadio('to')
    expect(cached('a')?.perspective).toBe('to')
    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1].body).toEqual({ perspective: 'to' })
    expectRadio('to')

    await act(async () =>
      patches()[1].reply(Response.json({ ...aiko, perspective: 'to' })),
    )
    await settle()
    expectRadio('to')
    expect(cached('a')?.perspective).toBe('to')
    expect(unexpected).toEqual([])
  })

  it('reads a cached Character with no perspective as "to"', async () => {
    const { user, patches, unexpected } = setup([aiko, legacy])
    await openSettings(user)

    await user.click(radio('As the Character'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    await act(async () =>
      patches()[0].reply(Response.json({ ...aiko, perspective: 'as' })),
    )
    await settle()
    expectRadio('as')

    await selectCharacter(user, 'Chiyo')
    await waitFor(() => expectRadio('to'))
    expect(patches()).toHaveLength(1)
    expect(unexpected).toEqual([])
  })
})

describe('AppExperience retry settings', () => {
  it('sends the dialog’s vibe, perspective and temperature without saving them to the Character', async () => {
    const seg = makeSegment('s1', '2026-10-01T00:00:00.000Z', {
      threadId: 't-a',
      vibe: 'casual',
      perspective: 'to',
    })
    const { user, qc, patches, posts, cached, unexpected } = setup(
      [aiko],
      [seg],
    )
    await user.click(
      await screen.findByRole('button', { name: 'Retry translation' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Retry translation settings',
    })
    const vibe = within(dialog).getByRole('slider', { name: 'Vibe' })
    const before = vibe.getAttribute('aria-valuetext')
    await user.keyboard('{ArrowRight}')
    const picked = vibe.getAttribute('aria-valuetext')
    expect(picked).not.toBe(before)
    fireEvent.change(
      within(dialog).getByRole('slider', { name: 'Temperature' }),
      { target: { value: '0.75' } },
    )
    await user.click(
      within(dialog).getByRole('radio', { name: 'As the Character' }),
    )
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].path).toBe('/api/segments/s1/retry')
    const body = posts()[0].body
    expect(body).toMatchObject({ perspective: 'as', temperature: 0.75 })
    expect(body?.vibe).toEqual(expect.any(String))
    expect(body?.vibe).not.toBe('casual')

    await act(async () =>
      posts()[0].reply(
        Response.json({
          ...seg,
          targetText: 'retried',
          vibe: body?.vibe,
          perspective: 'as',
        }),
      ),
    )
    await waitFor(() =>
      expect(
        qc.getQueryData<SegmentHistory>(keys.segments('t-a'))?.pages[0]
          .segments[0],
      ).toMatchObject({ id: 's1', perspective: 'as', vibe: body?.vibe }),
    )
    await settle()
    expect(patches()).toEqual([])
    expect(cached('a')).toMatchObject({ perspective: 'to', temperature: 0.4 })
    expect(unexpected).toEqual([])
  })
})

// The shell must keep its global controls usable while the mobile thread
// toolbar is collapsed, and must restore the toolbar on desktop.
function mobileViewport() {
  let narrow = true
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(max-width: 900px)' && narrow
    },
    media: query,
    addEventListener: (_event: string, listener: () => void) => {
      if (query === '(max-width: 900px)') listeners.add(listener)
    },
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }))
  localStorage.setItem('vibe-translate:active-character:u1', 'a')
  return {
    desktop: () =>
      act(() => {
        narrow = false
        listeners.forEach((listener) => listener())
      }),
  }
}

describe('AppExperience mobile thread toolbar', () => {
  it('toggles from the keyboard without hiding global controls or losing focus', async () => {
    mobileViewport()
    const { user } = setup([aiko])
    const toggle = await screen.findByRole('button', {
      name: 'Hide thread toolbar',
    })
    const toolbar = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toolbar.hasAttribute('inert')).toBe(false)

    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar.getAttribute('aria-hidden')).toBe('true')
    expect(toolbar.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(toggle)
    for (const name of ['Search or jump to', 'Toggle theme', 'Account']) {
      expect(screen.getByRole('button', { name })).toBeDefined()
    }

    await user.keyboard(' ')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toolbar.getAttribute('aria-hidden')).toBe('false')
    expect(toolbar.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(toggle)
  })

  it('always reveals a collapsed toolbar when the viewport becomes desktop', async () => {
    const viewport = mobileViewport()
    const { user } = setup([aiko])
    const toggle = await screen.findByRole('button', {
      name: 'Hide thread toolbar',
    })
    const toolbar = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!
    await user.click(toggle)
    expect(toolbar.hasAttribute('inert')).toBe(true)

    viewport.desktop()
    expect(toolbar.getAttribute('aria-hidden')).toBe('false')
    expect(toolbar.hasAttribute('inert')).toBe(false)
    expect(screen.queryByRole('button', { name: /thread toolbar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Share thread' })).toBeDefined()
  })
})
