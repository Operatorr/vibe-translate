// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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

    expect(card('Free')).toContain('1,000 credits')
    expect(card('Pro')).toContain('25,000 credits per billing renewal')
    expect(card('Linguist')).toContain('250,000 credits per billing renewal')
    expect(row('Credits')).toEqual([
      'Credits',
      '1,000 welcome',
      '25,000 per renewal',
      '250,000 per renewal',
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
    // Explain is Pro+ (the API returns 403 on Free) and spends credits.
    expect(row('Inline Explain')).toEqual([
      'Inline Explain',
      '',
      'Charged from credits',
      'Charged from credits',
    ])
  })
})
