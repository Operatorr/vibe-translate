import { describe, expect, it } from 'vitest'

import { TRANSLATE_PROMPT_REVISION } from '../prompts'
import { fingerprint, isCanonical } from '../translation-cache'

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

// A canonical-prompt change must not keep serving results generated under the
// previous prompt, so the revision is part of the key.
describe('fingerprint', () => {
  const input = {
    sourceText: 'See you tomorrow.',
    sourceLanguage: 'en-US',
    targetLanguage: 'zh-TW',
    vibe: 'casual' as const,
    modelId: 'openai/gpt-5-mini',
  }

  it('is stable for the same input and revision', async () => {
    expect(await fingerprint(input)).toBe(
      await fingerprint(input, TRANSLATE_PROMPT_REVISION),
    )
  })

  it('changes when the prompt revision changes', async () => {
    expect(await fingerprint(input, TRANSLATE_PROMPT_REVISION)).not.toBe(
      await fingerprint(input, TRANSLATE_PROMPT_REVISION - 1),
    )
  })
})
