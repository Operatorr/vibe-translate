// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreditRequiredModal } from '@/components/app/credit-required-modal'
import { apiFetch } from '@/lib/api'
import type { ReactNode } from 'react'

vi.mock('@/hooks/use-app-data', () => ({
  useMe: () => ({ data: { credits: { balance: 0 } } }),
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
})

describe('out-of-credits recovery', () => {
  it('opens on a real 402 API response, links to recovery pages and preserves draft text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'Insufficient credits' } },
          { status: 402 },
        ),
      ),
    )
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <textarea
          aria-label="Draft"
          defaultValue="The food was very good, thank you!"
        />
        <CreditRequiredModal />
      </QueryClientProvider>,
    )
    const draft = screen.getByRole('textbox') as HTMLTextAreaElement
    draft.focus()
    await act(async () => {
      await expect(apiFetch('/api/segments')).rejects.toMatchObject({
        status: 402,
      })
    })
    expect(
      screen.getByRole('dialog', { name: 'You’re out of credits.' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Explore Pro' }).getAttribute('href'),
    ).toBe('/pricing')
    expect(
      screen
        .getByRole('link', { name: 'View credits & top up' })
        .getAttribute('href'),
    ).toBe('/app/credits')
    expect(draft.value).toBe('The food was very good, thank you!')
    fireEvent.click(
      screen.getByRole('button', { name: 'Close credits dialog' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(draft)
    qc.clear()
  })
  it('shows the rejected request balance and reservation instead of a stale empty balance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: 'Not enough credits for this request',
              details: {
                code: 'insufficient_credits',
                balance: 198,
                requiredCredits: 418,
              },
            },
          },
          { status: 402 },
        ),
      ),
    )
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <CreditRequiredModal />
      </QueryClientProvider>,
    )
    await act(async () => {
      await expect(apiFetch('/api/segments')).rejects.toMatchObject({
        status: 402,
      })
    })
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
  it('does not open for other API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { message: 'Service unavailable' } },
          { status: 503 },
        ),
      ),
    )
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <CreditRequiredModal />
      </QueryClientProvider>,
    )
    await act(async () => {
      await expect(apiFetch('/api/segments')).rejects.toMatchObject({
        status: 503,
      })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    qc.clear()
  })
})
