import { describe, expect, it } from 'vitest'

import { isCanonical } from '../translation-cache'

// Canonicality gates the shared cross-user cache (adr/0004): anything that can
// shape the translate prompt must make a request non-canonical.
describe('isCanonical', () => {
  const base = { persona: { traits: [] }, temperature: 0.4 }

  it('accepts an empty persona, no instructions, default temperature', () => {
    expect(isCanonical(base)).toBe(true)
    expect(isCanonical({ temperature: 0.4 })).toBe(true)
  })

  it.each([
    ['age', { age: '60s', traits: [] }],
    ['region', { region: 'Osaka', traits: [] }],
    ['formality', { formality: 'blunt', traits: [] }],
    ['traits', { traits: ['warm'] }],
    ['tone', { tone: 'warm', traits: [] }],
    ['verbosity', { verbosity: 0.8, traits: [] }],
    // 0 is a real setting ("terse"), not an absent one.
    ['verbosity = 0', { verbosity: 0, traits: [] }],
  ])('rejects a persona with %s', (_label, persona) => {
    expect(isCanonical({ ...base, persona })).toBe(false)
  })

  it('treats a blank tone as absent', () => {
    expect(isCanonical({ ...base, persona: { tone: '', traits: [] } })).toBe(
      true,
    )
  })

  it('rejects instructions and non-default temperature', () => {
    expect(isCanonical({ ...base, instructions: 'tease a little' })).toBe(false)
    expect(isCanonical({ ...base, instructions: '   ' })).toBe(true)
    expect(isCanonical({ ...base, temperature: 0.9 })).toBe(false)
  })
})
