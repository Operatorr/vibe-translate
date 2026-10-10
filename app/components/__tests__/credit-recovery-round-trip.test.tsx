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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Composer } from '@/components/app/composer'
import { CreditRequiredModal } from '@/components/app/credit-required-modal'
import { getVibesForLang } from '@/components/vibe-design/design-data'
import { apiFetch } from '@/lib/api'

vi.mock('@/lib/auth-client', () => ({
  useSignedIn: () => true,
  authClient: {
    $store: { atoms: { session: { get: () => ({ data: null }) } } },
  },
}))

const DRAFT = 'The food was very good, thank you!'
const VIBES = getVibesForLang('ja-JP')

// The real composer, sending through the real apiFetch like AppExperience:
// resolves false on failure so the draft is kept.
function Workspace() {
  const send = async (text: string) => {
    try {
      await apiFetch('/api/segments', {
        method: 'POST',
        body: JSON.stringify({ threadId: 'thread-1', sourceText: text }),
      })
      return true
    } catch {
      return false
    }
  }
  return (
    <Composer
      contextId="thread-1"
      placeholder="Translate"
      sourceLanguage="en-US"
      vibes={VIBES}
      vibeIdx={0}
      onVibeChange={() => {}}
      temperature={0.4}
      onTemperatureChange={() => {}}
      onTemperatureCommit={() => {}}
      onSend={send}
      sending={false}
      draftOwner="u1"
    />
  )
}

// Mirrors app/routes: the /app layout mounts the modal beside its outlet.
function renderApp(initialPath = '/app') {
  const rootRoute = createRootRoute()
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'app',
    component: () => (
      <>
        <Outlet />
        <CreditRequiredModal />
      </>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => appRoute,
    path: '/',
    component: Workspace,
  })
  const creditsRoute = createRoute({
    getParentRoute: () => appRoute,
    path: 'credits',
    component: () => <h1>Credits and top-ups</h1>,
  })
  const pricingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'pricing',
    component: () => <h1>Pricing</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([indexRoute, creditsRoute]),
      pricingRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, qc }
}

let segmentReply: () => Response
beforeEach(() => {
  // Router scroll restoration; jsdom has no layout to scroll.
  vi.stubGlobal('scrollTo', vi.fn())
  segmentReply = () =>
    Response.json(
      { error: { message: 'Insufficient credits' } },
      { status: 402 },
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/users/me')
        return Response.json({
          id: 'u1',
          tier: 'free',
          credits: { balance: 0 },
        })
      if (path === '/api/segments') return segmentReply()
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

async function typeAndHit402(user: ReturnType<typeof userEvent.setup>) {
  const textarea = await screen.findByRole('textbox')
  await user.type(textarea, DRAFT)
  await user.keyboard('{Enter}')
  return screen.findByRole('dialog', { name: 'You’re out of credits.' })
}

describe('credit recovery round trip', () => {
  it('keeps the unsent draft across View credits & top up and Back', async () => {
    const user = userEvent.setup()
    const { router, qc } = renderApp()
    await typeAndHit402(user)
    await user.click(
      screen.getByRole('link', { name: 'View credits & top up' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Credits and top-ups' }),
    ).toBeTruthy()
    expect(router.state.location.pathname).toBe('/app/credits')
    // The composer unmounted with the route; the dialog closed with the link.
    expect(screen.queryByRole('textbox')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    act(() => router.history.back())
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(router.state.location.pathname).toBe('/app')
    expect(textarea.value).toBe(DRAFT)
    qc.clear()
  })

  it('keeps the draft through Explore Pro and a full-page checkout return', async () => {
    const user = userEvent.setup()
    const first = renderApp()
    await typeAndHit402(user)
    await user.click(screen.getByRole('link', { name: 'Explore Pro' }))
    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeTruthy()
    first.qc.clear()
    // Checkout leaves for the payment provider and reloads the app on return.
    cleanup()
    const second = renderApp('/app?upgraded=1')
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(textarea.value).toBe(DRAFT)

    // Once the send succeeds, nothing comes back on the next visit.
    segmentReply = () => Response.json({ id: 'seg-1' })
    await user.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(textarea.value).toBe(''))
    second.qc.clear()
    cleanup()
    const third = renderApp()
    expect(
      ((await screen.findByRole('textbox')) as HTMLTextAreaElement).value,
    ).toBe('')
    third.qc.clear()
  })
})
