// @vitest-environment jsdom
import { fireEvent, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VibePricingPage } from '@/components/vibe-design/pricing-page'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/auth-client', () => ({ useSignedIn: () => false }))
vi.mock('@/components/vibe-design/shell', () => ({ SiteNav: () => null }))
vi.mock('@/components/vibe-design/use-vibe-frame', () => ({
  useVibeFrame: () => ({
    theme: 'dark',
    onToggleTheme: () => {},
    onNavigate: () => {},
    paletteOpen: false,
    setPaletteOpen: () => {},
  }),
}))
afterEach(cleanup)

const card = (plan: string) =>
  screen.getByRole('heading', { level: 3, name: plan }).closest('.tier')
    ?.textContent ?? ''
const row = (feature: string) =>
  Array.from(
    screen.getByRole('cell', { name: feature }).closest('tr')?.cells ?? [],
    (cell) => cell.textContent,
  )

describe('pricing copy', () => {
  it('describes credit allowances and character caps, not unmetered or unlimited use', () => {
    render(<VibePricingPage />)
    const text = document.body.textContent ?? ''

    for (const stale of [
      'Daily token quota',
      '1M / mo',
      'tok / mo',
      'tok/mo',
      '20 / day',
    ])
      expect(text).not.toContain(stale)
    expect(text).not.toMatch(/unmetered/i)
    // Character caps are enforced (api/_lib/tier.ts), so never "unlimited".
    expect(text).not.toMatch(/unlimited/i)
    expect(text).not.toMatch(/trial|14 days|38 languages/i)
    expect(
      screen.getByRole('button', { name: 'Subscribe to Pro' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Subscribe to Linguist' }),
    ).toBeTruthy()
    expect(card('Free')).toContain('All 5 languages')
    expect(row('Languages')).toEqual(['Languages', '5', '5', '5'])

    expect(card('Free')).toContain('50,000 credits')
    expect(card('Pro')).toContain('42,000,000 credits per year')
    expect(card('Linguist')).toContain('168,000,000 credits per year')
    expect(row('Credits')).toEqual([
      'Credits',
      '50,000 welcome',
      '42,000,000 per year',
      '168,000,000 per year',
    ])
    expect(card('Free')).toContain('3 saved characters')
    expect(card('Pro')).toContain('100 saved characters')
    expect(card('Linguist')).toContain('1,000 saved characters')
    expect(row('Saved characters')).toEqual([
      'Saved characters',
      '3',
      '100',
      '1,000',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(card('Pro')).toContain('3,500,000 credits per month')
    expect(card('Linguist')).toContain('14,000,000 credits per month')
    expect(card('Pro')).toContain('$18')
    expect(card('Linguist')).toContain('$64')
    // Explain is on every tier and spends credits.
    expect(card('Free')).toContain('Grammar explanations, charged from credits')
    expect(row('Inline Explain')).toEqual([
      'Inline Explain',
      'Charged from credits',
      'Charged from credits',
      'Charged from credits',
    ])
  })
})
