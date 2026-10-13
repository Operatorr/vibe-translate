// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentCard } from '../segment-card'

import { getVibesForLang } from '@/components/vibe-design/design-data'
import type { Perspective } from '@/lib/types'

const VIBES = getVibesForLang('ja-JP')
const TAG = /\b(as|to) speaker\b/

// Each card sits in a labelled region so a tag can only satisfy the
// assertion for the card it belongs to. Cards get no Character perspective:
// the tag comes from the Segment's own snapshot.
const card = (id: string, perspective: Perspective | null) => (
  <section key={id} aria-label={`Segment ${id}`}>
    <SegmentCard
      seg={{
        id,
        sourceText: `source ${id}`,
        targetText: `target ${id}`,
        vibe: 'casual',
        perspective,
        tokenAlignment: [],
        createdAt: '2026-10-09T00:00:00Z',
      }}
      idx={1}
      isActive
      collapsed={false}
      sourceLanguage="en-US"
      targetLanguage="ja-JP"
      vibes={VIBES}
      onExpand={vi.fn()}
      onCopy={vi.fn()}
      onSpeak={vi.fn()}
    />
  </section>
)
const region = (id: string) =>
  within(screen.getByRole('region', { name: `Segment ${id}` }))

afterEach(cleanup)

describe('perspective tag on a segment card', () => {
  it.each([
    ['as' as const, 'Casual · as speaker'],
    ['to' as const, 'Casual · to speaker'],
  ])('shows a recorded %s snapshot next to the Vibe', (perspective, label) => {
    render(card('s1', perspective))
    expect(region('s1').getByText(label)).toBeTruthy()
  })

  it('shows no tag for a legacy row without a recorded perspective', () => {
    render(card('s1', null))
    expect(region('s1').getByText('Casual')).toBeTruthy()
    expect(region('s1').queryByText(TAG)).toBeNull()
  })

  it('tags each card with its own snapshot in a mixed history', () => {
    render(<>{[card('s1', 'as'), card('s2', null), card('s3', 'to')]}</>)
    expect(region('s1').getByText('Casual · as speaker')).toBeTruthy()
    expect(region('s2').queryByText(TAG)).toBeNull()
    expect(region('s3').getByText('Casual · to speaker')).toBeTruthy()
  })
})
