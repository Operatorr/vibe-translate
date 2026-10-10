// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CreditsPage,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_TIMEOUT_MS,
} from '@/components/app/credits-page'
import { keys } from '@/lib/query-keys'
import type { Me } from '@/lib/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/vibe-design/shell', () => ({
  SiteNav: ({ account }: { account?: ReactNode }) => <nav>{account}</nav>,
  CommandPalette: () => null,
}))
vi.mock('@/components/vibe-design/use-vibe-frame', () => ({
  useVibeFrame: () => ({
    theme: 'dark',
    onToggleTheme: () => {},
    onNavigate: () => {},
    paletteOpen: false,
    setPaletteOpen: () => {},
  }),
}))
vi.mock('@/components/app/account-menu', () => ({ AccountMenu: () => null }))
vi.mock('@/lib/auth-client', () => ({ useSignedIn: () => true }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ORDER = '3f2c1a9e-7b4d-4e8f-9a6b-1c2d3e4f5a6b'
const NEXT_ORDER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

type Pack = {
  id: 'small' | 'medium' | 'large'
  credits: number
  available: boolean
  price: { amount: number; currency: string } | null
}
type History = {
  me: Me
  packs: Pack[]
  order: { credits: number; fulfilled: boolean } | null
  ledger: Array<{
    id: string
    delta: number
    reason: string
    pending: boolean
    createdAt: string
  }>
}

const me = (balance = 1200): Me => ({
  id: 'user-1',
  email: 'mai@example.com',
  displayName: 'Mai',
  tier: 'free',
  limits: {
    characters: 3,
    threadsPerCharacter: 20,
    credits: 1000,
    retentionDays: 30,
    aiDictation: false,
    explain: false,
    translationMemory: false,
    customVibeStops: false,
    elevenLabsTts: false,
  },
  credits: { balance, refilledAt: null },
  byok: {
    configured: false,
    last4: null,
    translateModelId: null,
    explainModelId: null,
  },
  onboardingComplete: true,
})
const PACKS: Pack[] = [
  {
    id: 'small',
    credits: 1000,
    available: true,
    price: { amount: 900, currency: 'USD' },
  },
  {
    id: 'medium',
    credits: 5000,
    available: true,
    price: { amount: 900, currency: 'JPY' },
  },
  {
    id: 'large',
    credits: 15000,
    available: true,
    price: { amount: 4900, currency: 'USD' },
  },
]
const history = (overrides: Partial<History> = {}): History => ({
  me: me(),
  packs: PACKS,
  order: null,
  ledger: [],
  ...overrides,
})

type Route = (init: RequestInit | undefined, url: string) => Response
// Routes the page's two endpoints; every other request is a test bug.
function stubApi(routes: { history: Route; checkout?: Route }) {
  const historyCalls: string[] = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/users/me/credits')) {
        historyCalls.push(url)
        return routes.history(init, url)
      }
      if (url === '/api/billing/credits/checkout' && routes.checkout)
        return routes.checkout(init, url)
      throw new Error(`Unexpected request: ${url}`)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, historyCalls }
}
const json = (body: unknown, status = 200) => Response.json(body, { status })
// Each call takes the next response; the last one repeats.
const sequence = (...bodies: History[]): Route => {
  let call = 0
  return () => json(bodies[Math.min(call++, bodies.length - 1)])
}

function renderPage(orderId?: string, qc = testClient()) {
  const tree = (id?: string) => (
    <QueryClientProvider client={qc}>
      <CreditsPage orderId={id} />
    </QueryClientProvider>
  )
  const view = render(tree(orderId))
  return { ...view, qc, setOrder: (id?: string) => view.rerender(tree(id)) }
}
function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const buyButton = () =>
  screen.getByRole('button', {
    name: /Buy credits|Opening checkout/,
  }) as HTMLButtonElement
const radio = (name: RegExp) =>
  screen.getByRole('radio', { name }) as HTMLInputElement
const money = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    value,
  )

describe('checkout return polling', () => {
  it('shows the wait until the order is verified, then the credits added', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { historyCalls } = stubApi({
      history: sequence(
        history({ order: { credits: 5000, fulfilled: false } }),
        history({ me: me(6200), order: { credits: 5000, fulfilled: true } }),
      ),
    })
    const { qc } = renderPage(ORDER)

    expect(
      await screen.findByText(/Waiting for payment confirmation/),
    ).not.toBeNull()
    expect(historyCalls[0]).toBe(`/api/users/me/credits?orderId=${ORDER}`)
    await advance(PAYMENT_POLL_INTERVAL_MS)

    expect(
      await screen.findByText(
        '5,000 credits added. You’re ready to translate.',
      ),
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Check payment' })).toBeNull()
    expect(qc.getQueryData<Me>(keys.me)?.credits.balance).toBe(6200)
    // A verified order stops the polling.
    const settled = historyCalls.length
    await advance(PAYMENT_POLL_INTERVAL_MS * 3)
    expect(historyCalls.length).toBe(settled)
  })

  it('stops polling after the timeout, and Check payment restarts the window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { historyCalls } = stubApi({
      history: sequence(
        history({ order: { credits: 5000, fulfilled: false } }),
      ),
    })
    renderPage(ORDER)
    await screen.findByText(/Waiting for payment confirmation/)

    await advance(PAYMENT_POLL_TIMEOUT_MS + PAYMENT_POLL_INTERVAL_MS * 2)
    const stopped = historyCalls.length
    expect(stopped).toBeGreaterThan(PAYMENT_POLL_TIMEOUT_MS / 4000)
    await advance(PAYMENT_POLL_INTERVAL_MS * 5)
    expect(historyCalls.length).toBe(stopped)

    fireEvent.click(screen.getByRole('button', { name: 'Check payment' }))
    await waitFor(() => expect(historyCalls.length).toBe(stopped + 1))
    await advance(PAYMENT_POLL_INTERVAL_MS)
    await waitFor(() => expect(historyCalls.length).toBe(stopped + 2))
  })

  it('gives a new order its own polling window without a remount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { historyCalls } = stubApi({
      history: sequence(
        history({ order: { credits: 5000, fulfilled: false } }),
      ),
    })
    const { setOrder } = renderPage(ORDER)
    await screen.findByText(/Waiting for payment confirmation/)
    await advance(PAYMENT_POLL_TIMEOUT_MS + PAYMENT_POLL_INTERVAL_MS * 2)

    setOrder(NEXT_ORDER)
    const nextCalls = () =>
      historyCalls.filter((url) => url.endsWith(NEXT_ORDER)).length
    await waitFor(() => expect(nextCalls()).toBe(1))
    await advance(PAYMENT_POLL_INTERVAL_MS)
    await waitFor(() => expect(nextCalls()).toBe(2))
  })
})

describe('top-up packs and checkout', () => {
  it('falls back from an unavailable pack to the first available one', async () => {
    const { fetchMock } = stubApi({
      history: () =>
        json(
          history({
            packs: [
              { ...PACKS[0], available: false, price: null },
              PACKS[1],
              PACKS[2],
            ],
          }),
        ),
      checkout: () => json({ checkoutUrl: 'https://checkout.test/s' }),
    })
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    renderPage()
    await screen.findByText('Choose your top-up')

    expect(radio(/^1,000 credits/).disabled).toBe(true)
    expect(radio(/^1,000 credits/).checked).toBe(false)
    expect(radio(/^1,000 credits/).closest('label')?.textContent).toContain(
      'Unavailable',
    )
    expect(radio(/^5,000 credits/).checked).toBe(true)
    fireEvent.click(buyButton())

    await waitFor(() => expect(assign).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls.at(-1)!
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ pack: 'medium' })
  })

  it('explains when no top-up is available', async () => {
    stubApi({
      history: () =>
        json(
          history({
            packs: PACKS.map((pack) => ({
              ...pack,
              available: false,
              price: null,
            })),
          }),
        ),
    })
    renderPage()

    expect(
      await screen.findByText(
        'Credit top-ups are currently unavailable. Try refreshing or come back later.',
      ),
    ).not.toBeNull()
    expect(buyButton().disabled).toBe(true)
  })

  it('shows a checkout error and re-enables the purchase', async () => {
    stubApi({
      history: () => json(history()),
      checkout: () =>
        json({ error: { message: 'Payments are paused right now.' } }, 503),
    })
    renderPage()
    await screen.findByText('Choose your top-up')
    fireEvent.click(buyButton())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Payments are paused right now.',
    )
    expect(buyButton().textContent).toBe('Buy credits →')
    expect(buyButton().disabled).toBe(false)
    expect(radio(/^1,000 credits/).matches(':disabled')).toBe(false)
  })

  it('opens the checkout URL and recovers the button on a BFCache restore', async () => {
    stubApi({
      history: () => json(history()),
      checkout: () => json({ checkoutUrl: 'https://checkout.test/session' }),
    })
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    renderPage()
    await screen.findByText('Choose your top-up')
    fireEvent.click(buyButton())

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.test/session'),
    )
    expect(buyButton().textContent).toBe('Opening checkout…')
    expect(buyButton().disabled).toBe(true)
    expect(radio(/^1,000 credits/).matches(':disabled')).toBe(true)

    // A normal (non-persisted) pageshow is not a restore.
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: false }),
      )
    })
    expect(buyButton().disabled).toBe(true)

    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      )
    })
    expect(buyButton().textContent).toBe('Buy credits →')
    expect(buyButton().disabled).toBe(false)
    expect(radio(/^1,000 credits/).matches(':disabled')).toBe(false)
  })

  it('formats Dodo minor units per currency', async () => {
    stubApi({ history: () => json(history()) })
    renderPage()
    await screen.findByText('Choose your top-up')

    // USD has two decimals (900 → 9.00); JPY has none (900 → 900).
    expect(radio(/^1,000 credits/).closest('label')?.textContent).toContain(
      money(9, 'USD'),
    )
    expect(radio(/^5,000 credits/).closest('label')?.textContent).toContain(
      money(900, 'JPY'),
    )
    expect(radio(/^15,000 credits/).closest('label')?.textContent).toContain(
      money(49, 'USD'),
    )
  })
})

describe('balance and activity', () => {
  it.each([0, -250])('renders a balance of %i', async (balance) => {
    stubApi({ history: () => json(history({ me: me(balance) })) })
    renderPage()

    const card = await screen.findByRole('region', { name: 'Credit balance' })
    expect(
      card.querySelector('.credits-page__amount')?.textContent?.trim(),
    ).toBe(`${balance.toLocaleString()} credits`)
  })

  it('labels a reversed top-up as a negative entry', async () => {
    stubApi({
      history: () =>
        json(
          history({
            me: me(-250),
            ledger: [
              {
                id: 'l2',
                delta: -5000,
                reason: 'reversal.purchase',
                pending: false,
                createdAt: '2026-10-09T12:00:00.000Z',
              },
              {
                id: 'l1',
                delta: 5000,
                reason: 'grant.purchase',
                pending: false,
                createdAt: '2026-10-08T12:00:00.000Z',
              },
            ],
          }),
        ),
    })
    renderPage()

    const items = within(await screen.findByRole('list')).getAllByRole(
      'listitem',
    )
    expect(items[0].textContent).toContain('Top-up reversed')
    expect(items[0].textContent).toContain('-5,000')
    expect(items[0].querySelector('.is-credit')).toBeNull()
    expect(items[1].textContent).toContain('Credit top-up')
    expect(items[1].textContent).toContain('+5,000')
  })

  it('writes every fresh response into the shared account cache', async () => {
    stubApi({
      history: sequence(history({ me: me(1200) }), history({ me: me(900) })),
    })
    const { qc } = renderPage()
    await waitFor(() =>
      expect(qc.getQueryData<Me>(keys.me)?.credits.balance).toBe(1200),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh balance' }))
    await waitFor(() =>
      expect(qc.getQueryData<Me>(keys.me)?.credits.balance).toBe(900),
    )
  })

  it('does not let cached history overwrite a newer account read', async () => {
    // The refetch never settles, so only the cached history is rendered.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const qc = testClient()
    const now = Date.now()
    qc.setQueryData(keys.credits(null), history({ me: me(1200) }), {
      updatedAt: now - 60_000,
    })
    qc.setQueryData(keys.me, me(700), { updatedAt: now - 1000 })
    renderPage(undefined, qc)

    await screen.findByRole('region', { name: 'Credit balance' })
    expect(qc.getQueryData<Me>(keys.me)?.credits.balance).toBe(700)
  })
})
