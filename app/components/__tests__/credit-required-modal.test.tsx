// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreditRequiredModal } from '@/components/app/credit-required-modal'
import { SegmentCard } from '@/components/app/segment-card'
import { apiFetch } from '@/lib/api'
import { keys } from '@/lib/query-keys'
import type { UserTier } from '@/lib/types'
import type { ReactNode } from 'react'

// The real useMe runs (its query is enabled only while the dialog is open);
// only the session it gates on is faked.
vi.mock('@/lib/auth-client', () => ({
  useSignedIn: () => true,
  authClient: {
    $store: { atoms: { session: { get: () => ({ data: null }) } } },
  },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Reply = () => Response | Promise<Response>
const me = (balance: number, tier: UserTier = 'free') => ({
  id: 'u1',
  tier,
  credits: { balance },
})
const meReply =
  (balance: number, tier: UserTier = 'free'): Reply =>
  () =>
    Response.json(me(balance, tier))
const legacy402: Reply = () =>
  Response.json({ error: { message: 'Insufficient credits' } }, { status: 402 })
const detailed402 =
  (balance: number, requiredCredits: number): Reply =>
  () =>
    Response.json(
      {
        error: {
          message: 'Not enough credits for this request',
          details: { code: 'insufficient_credits', balance, requiredCredits },
        },
      },
      { status: 402 },
    )

// Each path answers with its replies in order, repeating the last one.
function stubApi(routes: Record<string, Reply | Reply[]>) {
  const calls = new Map<string, number>()
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    const route = routes[path]
    if (!route) throw new Error(`Unexpected request: ${path}`)
    const replies = Array.isArray(route) ? route : [route]
    const n = calls.get(path) ?? 0
    calls.set(path, n + 1)
    return replies[Math.min(n, replies.length - 1)]()
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    count: (path: string) =>
      fetchMock.mock.calls.filter(([input]) => String(input) === path).length,
  }
}

function renderWithQuery(ui: ReactNode, qc = new QueryClient()) {
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
  return qc
}

async function trigger402(path = '/api/segments') {
  await act(async () => {
    await expect(apiFetch(path)).rejects.toMatchObject({ status: 402 })
  })
}

describe('out-of-credits recovery', () => {
  it('opens on a real 402 API response, links to recovery pages and preserves draft text', async () => {
    stubApi({ '/api/segments': legacy402, '/api/users/me': meReply(0) })
    const qc = renderWithQuery(
      <>
        <textarea
          aria-label="Draft"
          defaultValue="The food was very good, thank you!"
        />
        <CreditRequiredModal />
      </>,
    )
    const draft = screen.getByRole('textbox') as HTMLTextAreaElement
    draft.focus()
    await trigger402()
    expect(
      await screen.findByRole('dialog', { name: 'You’re out of credits.' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Explore Pro' }).getAttribute('href'),
    ).toBe('/pricing')
    expect(
      screen
        .getByRole('link', { name: 'View credits & top up' })
        .getAttribute('href'),
    ).toBe('/app/credits')
    expect(screen.getByText(/your draft is saved/i)).toBeTruthy()
    expect(draft.value).toBe('The food was very good, thank you!')
    fireEvent.click(
      screen.getByRole('button', { name: 'Close credits dialog' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(draft)
    qc.clear()
  })

  it('shows the rejected request balance and reservation instead of a stale empty balance', async () => {
    const api = stubApi({
      '/api/segments': detailed402(198, 418),
      '/api/users/me': meReply(0),
    })
    const qc = renderWithQuery(<CreditRequiredModal />)
    await trigger402()
    await waitFor(() => expect(api.count('/api/users/me')).toBe(1))
    expect(
      screen.getByRole('dialog', { name: 'You need more credits.' }),
    ).toBeTruthy()
    expect(screen.getByText('198 credits remaining')).toBeTruthy()
    expect(
      screen.getByText(/418 credits needed to start this request/),
    ).toBeTruthy()
    expect(screen.getByText(/temporary reservation/i)).toBeTruthy()
    qc.clear()
  })

  it('does not open, or read the balance, for other API errors', async () => {
    const api = stubApi({
      '/api/segments': () =>
        Response.json(
          { error: { message: 'Service unavailable' } },
          { status: 503 },
        ),
      '/api/users/me': meReply(0),
    })
    const qc = renderWithQuery(<CreditRequiredModal />)
    await act(async () => {
      await expect(apiFetch('/api/segments')).rejects.toMatchObject({
        status: 503,
      })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    // The balance query stays disabled while the dialog is closed.
    expect(api.count('/api/users/me')).toBe(0)
    qc.clear()
  })

  it('refetches a cached balance when it opens for a legacy 402', async () => {
    const api = stubApi({
      '/api/segments': legacy402,
      '/api/users/me': meReply(0),
    })
    const qc = new QueryClient()
    // Fresh by staleTime, so only the open-time invalidation can refetch it.
    qc.setQueryData(keys.me, me(500))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    renderWithQuery(<CreditRequiredModal />, qc)
    await act(async () => {})
    expect(api.count('/api/users/me')).toBe(0)
    await trigger402()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.me })
    expect(await screen.findByText('0 credits remaining')).toBeTruthy()
    expect(
      screen.getByRole('dialog', { name: 'You’re out of credits.' }),
    ).toBeTruthy()
    expect(screen.queryByText('500 credits remaining')).toBeNull()
    expect(api.count('/api/users/me')).toBe(1)
    qc.clear()
  })

  it('returns focus to where it was before the first 402, however many follow', async () => {
    stubApi({
      '/api/segments': [
        detailed402(100, 300),
        detailed402(100, 300),
        detailed402(50, 600),
      ],
      '/api/users/me': meReply(50),
    })
    const qc = renderWithQuery(
      <>
        <textarea aria-label="Draft" />
        <CreditRequiredModal />
      </>,
    )
    const draft = screen.getByRole('textbox')
    draft.focus()
    // Two closely spaced rejections, then one after focus moved into the dialog.
    await act(async () => {
      await Promise.all([
        expect(apiFetch('/api/segments')).rejects.toMatchObject({
          status: 402,
        }),
        expect(apiFetch('/api/segments')).rejects.toMatchObject({
          status: 402,
        }),
      ])
    })
    const dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    )
    await trigger402()
    // The newest rejection still updates what the dialog shows.
    expect(screen.getByText('50 credits remaining')).toBeTruthy()
    expect(screen.getByText(/600 credits needed/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Close credits dialog' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(draft)
    qc.clear()
  })

  it('opens above an open full-screen translation display and takes focus', async () => {
    stubApi({
      '/api/segments': detailed402(0, 120),
      '/api/users/me': meReply(0),
    })
    const user = userEvent.setup()
    const qc = renderWithQuery(
      <>
        <SegmentCard
          seg={{
            id: 's1',
            sourceText: 'Good evening',
            targetText: '晚安',
            vibe: 'keigo',
            tokenAlignment: [{ t: '晚安', src: 'Good evening' }],
            createdAt: '2026-10-09T00:00:00Z',
          }}
          idx={1}
          isActive
          collapsed={false}
          sourceLanguage="en-US"
          targetLanguage="zh-TW"
          vibes={[]}
          onExpand={vi.fn()}
          onCopy={vi.fn()}
          onSpeak={vi.fn()}
        />
        <CreditRequiredModal />
      </>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Show translation full screen' }),
    )
    const display = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(display.contains(document.activeElement)).toBe(true),
    )
    await trigger402()
    const credit = await screen.findByRole('dialog', {
      name: 'You’re out of credits.',
    })
    await waitFor(() =>
      expect(credit.contains(document.activeElement)).toBe(true),
    )
    // The display stays open underneath; only the recovery dialog is exposed.
    expect(display.isConnected).toBe(true)
    expect(screen.getAllByRole('dialog')).toEqual([credit])
    fireEvent.click(
      screen.getByRole('button', { name: 'Close credits dialog' }),
    )
    await waitFor(() => expect(credit.isConnected).toBe(false))
    expect(display.contains(document.activeElement)).toBe(true)
    qc.clear()
  })

  it('is the topmost overlay layer in the stylesheet', () => {
    // jsdom applies no stylesheet, so check the z-index rules themselves.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/app.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const layers: { selectors: string[]; z: number }[] = []
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const z = /z-index:\s*(\d+)/.exec(body)
      if (z)
        layers.push({
          selectors: selectors.split(',').map((s) => s.trim()),
          z: Number(z[1]),
        })
    }
    const zOf = (selector: string) =>
      layers.filter((l) => l.selectors.includes(selector)).map((l) => l.z)
    const recovery = [...zOf('.credit-modal__overlay'), ...zOf('.credit-modal')]
    const display = [
      ...zOf('.translation-display__overlay'),
      ...zOf('.translation-display'),
    ]
    expect(recovery.length).toBeGreaterThan(0)
    expect(display.length).toBeGreaterThan(0)
    expect(Math.min(...recovery)).toBeGreaterThan(Math.max(...display))
    const others = layers
      .filter((l) => !l.selectors.some((s) => s.startsWith('.credit-modal')))
      .map((l) => l.z)
    expect(Math.min(...recovery)).toBeGreaterThan(Math.max(...others))
  })
})

describe('upgrade option by plan', () => {
  it.each([
    {
      tier: 'free' as const,
      heading: 'Upgrade to Pro',
      cta: 'Explore Pro',
      description: /larger allowance with Pro/,
    },
    {
      tier: 'pro' as const,
      heading: 'Upgrade to Linguist',
      cta: 'Explore Linguist',
      description: /larger allowance with Linguist/,
    },
  ])('$tier offers $heading', async ({ tier, heading, cta, description }) => {
    stubApi({
      '/api/segments': detailed402(0, 120),
      '/api/users/me': meReply(0, tier),
    })
    const qc = renderWithQuery(<CreditRequiredModal />)
    await trigger402()
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByRole('link', { name: cta }).getAttribute('href')).toBe(
      '/pricing',
    )
    expect(screen.getByText(description)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'View credits & top up' }),
    ).toBeTruthy()
    qc.clear()
  })

  it('Linguist (team) gets top-up only, with a note about the largest plan', async () => {
    const api = stubApi({
      '/api/segments': detailed402(0, 120),
      '/api/users/me': meReply(0, 'team'),
    })
    const qc = renderWithQuery(<CreditRequiredModal />)
    await trigger402()
    expect(
      await screen.findByText(/you’re on linguist, our largest plan/i),
    ).toBeTruthy()
    expect(api.count('/api/users/me')).toBe(1)
    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href')),
    ).toEqual(['/app/credits'])
    expect(screen.queryByRole('heading', { name: /upgrade/i })).toBeNull()
    expect(
      screen.getByText('Add credits for your next translation.'),
    ).toBeTruthy()
    qc.clear()
  })

  it('offers a neutral plan comparison while the plan is still loading', async () => {
    stubApi({
      '/api/segments': detailed402(0, 120),
      '/api/users/me': () => new Promise<Response>(() => {}),
    })
    const qc = renderWithQuery(<CreditRequiredModal />)
    await trigger402()
    expect(
      screen.getByRole('link', { name: 'Compare plans' }).getAttribute('href'),
    ).toBe('/pricing')
    expect(screen.queryByRole('heading', { name: /upgrade/i })).toBeNull()
    qc.clear()
  })
})
