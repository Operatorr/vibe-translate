// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentCard } from '../segment-card'

function renderCard(tokenUsage: Record<string, unknown> = {}) {
  render(
    <SegmentCard
      seg={{
        id: 's1',
        sourceText: 'Good evening',
        targetText: '晚安',
        vibe: 'keigo',
        tokenAlignment: [{ t: '晚安', src: 'Good evening' }],
        tokenUsage,
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
    />,
  )
}
afterEach(cleanup)

describe('translation usage on a segment card', () => {
  it('shows full provider usage and explains input/output on touch or click', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99 })
    expect(screen.queryByText('449 tok')).not.toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Token usage: 449 total tokens' }),
    )
    const breakdown = within(
      screen.getByRole('dialog', { name: 'Translation usage' }),
    )
    expect(breakdown.getByText('350')).toBeTruthy()
    expect(breakdown.getByText('99')).toBeTruthy()
    expect(breakdown.getByText('449')).toBeTruthy()
    expect(
      breakdown.getByText(/credit charges use input and output tokens/i),
    ).toBeTruthy()
  })
  it('shows the actual stored credit charge separately from provider token usage', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99, creditsCharged: 898 })
    await userEvent.click(screen.getByRole('button', { name: /token usage/i }))
    expect(screen.getByText('Credits charged')).toBeTruthy()
    expect(screen.getByText('898')).toBeTruthy()
    expect(screen.getByText('449')).toBeTruthy()
  })
  it('does not imply a BYOK translation spent platform credits', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99, creditsCharged: 0 })
    await userEvent.click(screen.getByRole('button', { name: /token usage/i }))
    expect(screen.getByText('Credits charged')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
  })
  it('labels output-only legacy data without claiming it is the total', () => {
    renderCard({ completionTokens: 99 })
    expect(screen.queryByText('99 output tok')).not.toBeNull()
  })
  it('marks a shared cache hit as free and hides unrecorded usage', () => {
    renderCard({ cached: true })
    expect(screen.queryByText('cached · 0 credits')).not.toBeNull()
    cleanup()
    renderCard({})
    expect(screen.queryByRole('button', { name: /token usage/i })).toBeNull()
    expect(screen.queryByText(/99/)).toBeNull()
  })
})
