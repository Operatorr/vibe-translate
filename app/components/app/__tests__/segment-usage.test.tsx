// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentCard } from '../segment-card'

function renderCard(tokenUsage: Record<string, unknown> = {}) {
  return render(
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

// Reads the value from the label's own row, so a number shown under a
// different label cannot satisfy the assertion.
function valueFor(label: string) {
  const breakdown = within(
    screen.getByRole('dialog', { name: 'Translation usage' }),
  )
  const term = breakdown.getByText(label, { selector: 'dt' })
  return within(term.parentElement!).getByRole('definition').textContent
}

const NR = 'Not recorded'

describe('translation usage on a segment card', () => {
  it('shows full provider usage and explains input/output on touch or click', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99 })
    expect(screen.queryByText('449 tok')).not.toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Token usage: 449 total tokens' }),
    )
    expect(valueFor('Input tokens')).toBe('350')
    expect(valueFor('Output tokens')).toBe('99')
    expect(valueFor('Total tokens')).toBe('449')
    expect(valueFor('Credits charged')).toBe(NR)
    expect(
      screen.getByText(/credit charges use input and output tokens/i),
    ).toBeTruthy()
  })
  it('shows the actual stored credit charge separately from provider token usage', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99, creditsCharged: 898 })
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Token usage: 449 total tokens, 898 credits charged',
      }),
    )
    expect(valueFor('Input tokens')).toBe('350')
    expect(valueFor('Output tokens')).toBe('99')
    expect(valueFor('Total tokens')).toBe('449')
    expect(valueFor('Credits charged')).toBe('898')
  })
  it('does not imply a BYOK translation spent platform credits', async () => {
    renderCard({ promptTokens: 350, completionTokens: 99, creditsCharged: 0 })
    const trigger = screen.getByRole('button', {
      name: 'Token usage: 449 total tokens, 0 credits charged',
    })
    expect(trigger.textContent).toBe('0 credits')
    await userEvent.click(trigger)
    expect(valueFor('Total tokens')).toBe('449')
    expect(valueFor('Credits charged')).toBe('0')
  })
  it('labels output-only legacy data without claiming it is the total', () => {
    renderCard({ completionTokens: 99 })
    const trigger = screen.getByRole('button', {
      name: 'Token usage: 99 output tokens, total not recorded',
    })
    expect(trigger.textContent).toBe('99 output tok')
  })
  it('marks a shared cache hit as free', () => {
    renderCard({ cached: true })
    expect(screen.queryByText('cached · 0 credits')).not.toBeNull()
  })
  it('hides unrecorded usage', () => {
    const { container } = renderCard({})
    expect(screen.queryByRole('button', { name: /token usage/i })).toBeNull()
    expect(container.querySelector('.segment__tgt-meta')).toBeNull()
  })

  // values: input, output, total, credits charged.
  it.each([
    {
      name: 'accepts numeric strings',
      usage: { promptTokens: '350', completionTokens: ' 99 ' },
      trigger: '449 tok',
      label: 'Token usage: 449 total tokens',
      values: ['350', '99', '449', NR],
    },
    {
      name: 'rejects whitespace-only strings',
      usage: { promptTokens: ' ', completionTokens: 99, creditsCharged: '' },
      trigger: '99 output tok',
      label: 'Token usage: 99 output tokens, total not recorded',
      values: [NR, '99', NR, NR],
    },
    {
      name: 'rejects negative counts',
      usage: { promptTokens: -350, completionTokens: 99, creditsCharged: '-5' },
      trigger: '99 output tok',
      label: 'Token usage: 99 output tokens, total not recorded',
      values: [NR, '99', NR, NR],
    },
    {
      name: 'rejects fractional counts',
      usage: { promptTokens: 350, completionTokens: 99.5, creditsCharged: 1.5 },
      trigger: '350 input tok',
      label: 'Token usage: 350 input tokens, total not recorded',
      values: ['350', NR, NR, NR],
    },
    {
      name: 'rejects Infinity and NaN',
      usage: {
        promptTokens: Infinity,
        completionTokens: NaN,
        creditsCharged: 12,
      },
      trigger: '12 credits',
      label: 'Token usage: not recorded, 12 credits charged',
      values: [NR, NR, NR, '12'],
    },
    {
      name: 'rejects unsafe integers',
      usage: { promptTokens: 2 ** 53, completionTokens: 99 },
      trigger: '99 output tok',
      label: 'Token usage: 99 output tokens, total not recorded',
      values: [NR, '99', NR, NR],
    },
    {
      name: 'rejects hex and exponent strings',
      usage: {
        promptTokens: '0x15E',
        completionTokens: 99,
        creditsCharged: '1e3',
      },
      trigger: '99 output tok',
      label: 'Token usage: 99 output tokens, total not recorded',
      values: [NR, '99', NR, NR],
    },
    {
      name: 'labels input-only usage',
      usage: { promptTokens: 350 },
      trigger: '350 input tok',
      label: 'Token usage: 350 input tokens, total not recorded',
      values: ['350', NR, NR, NR],
    },
    {
      name: 'labels credits-only usage',
      usage: { creditsCharged: 12 },
      trigger: '12 credits',
      label: 'Token usage: not recorded, 12 credits charged',
      values: [NR, NR, NR, '12'],
    },
    {
      name: 'shows a zero BYOK charge recorded as a string',
      usage: { promptTokens: 350, completionTokens: 99, creditsCharged: '0' },
      trigger: '0 credits',
      label: 'Token usage: 449 total tokens, 0 credits charged',
      values: ['350', '99', '449', '0'],
    },
  ])('$name', async ({ usage, trigger, label, values }) => {
    renderCard(usage)
    const button = screen.getByRole('button', { name: label })
    expect(button.textContent).toBe(trigger)
    await userEvent.click(button)
    expect(valueFor('Input tokens')).toBe(values[0])
    expect(valueFor('Output tokens')).toBe(values[1])
    expect(valueFor('Total tokens')).toBe(values[2])
    expect(valueFor('Credits charged')).toBe(values[3])
  })

  it.each([
    {
      name: 'only malformed counts',
      usage: {
        promptTokens: 'Infinity',
        completionTokens: NaN,
        creditsCharged: ' ',
      },
    },
    {
      name: 'zero tokens and no charge',
      usage: { promptTokens: 0, completionTokens: 0 },
    },
  ])('hides usage with $name', ({ usage }) => {
    const { container } = renderCard(usage)
    expect(screen.queryByRole('button', { name: /token usage/i })).toBeNull()
    expect(container.querySelector('.segment__tgt-meta')).toBeNull()
  })
})
