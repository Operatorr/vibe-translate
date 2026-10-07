import { describe, expect, it } from 'vitest'

import {
  draftFrom,
  switchTargetLanguage,
  toCharacterPatch,
  toInput,
  type Draft,
} from '../character-draft'
import { getTraitsForLanguage } from '../character-options'
import { characterEditSchema, characterFormSchema } from '../schemas'
import type { Character } from '../types'

const character = (overrides: Partial<Character> = {}): Character => ({
  id: 'c1',
  name: 'Lin',
  sourceLanguage: 'en-US',
  targetLanguage: 'zh-TW',
  defaultVibe: 'casual',
  temperature: 0.4,
  persona: { traits: [] },
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  ...draftFrom(character(), 'var(--cyan-400)'),
  ...overrides,
})

describe('switchTargetLanguage', () => {
  it('clears a region suggested for the old language', () => {
    const next = switchTargetLanguage(draft({ region: 'Taiwan' }), 'th-TH')
    expect(next.targetLanguage).toBe('th-TH')
    expect(next.region).toBe('')
  })

  it('keeps a custom region', () => {
    expect(
      switchTargetLanguage(draft({ region: 'Taichung' }), 'th-TH').region,
    ).toBe('Taichung')
  })

  it('drops traits only the old language suggests, keeping common, shared and custom ones', () => {
    const traits = new Set([
      'playful', // common to every language
      'English code-switching', // zh-TW and th-TH both offer it
      'Cantonese sentence particles', // zh-TW only
      'loves puns', // custom
    ])
    const next = switchTargetLanguage(draft({ traits }), 'th-TH')
    expect([...next.traits]).toEqual([
      'playful',
      'English code-switching',
      'loves puns',
    ])
  })

  it('does not restore dropped suggestions when switching back', () => {
    const start = draft({
      region: 'Hong Kong (Cantonese)',
      traits: new Set(['Cantonese expressions', 'loves puns']),
    })
    const back = switchTargetLanguage(
      switchTargetLanguage(start, 'ja-JP'),
      'zh-TW',
    )
    expect(back.region).toBe('')
    expect([...back.traits]).toEqual(['loves puns'])
  })

  it('keeps everything when leaving a legacy language that had no suggestions', () => {
    const legacy = draft({
      targetLanguage: 'ko-KR',
      region: 'Busan',
      traits: new Set(['blunt', 'satoori']),
    })
    const next = switchTargetLanguage(legacy, 'ja-JP')
    expect(next.region).toBe('Busan')
    expect([...next.traits]).toEqual(['blunt', 'satoori'])
  })

  it('does not mutate the previous draft', () => {
    const before = draft({ traits: new Set(['Cantonese expressions']) })
    switchTargetLanguage(before, 'th-TH')
    expect(before.targetLanguage).toBe('zh-TW')
    expect(before.traits.has('Cantonese expressions')).toBe(true)
  })
})

describe('getTraitsForLanguage', () => {
  it('offers only common traits for a legacy language', () => {
    expect(getTraitsForLanguage('ko-KR')).toContain('playful')
    expect(getTraitsForLanguage('ko-KR')).not.toContain('Thai idioms')
  })
})

describe('editing a legacy-language Character', () => {
  const legacy = character({ sourceLanguage: 'ko-KR', targetLanguage: 'fr-FR' })

  it('validates a name-only edit that keeps the saved languages', () => {
    const input = toInput({ ...draftFrom(legacy, 'x'), name: 'Lina' })
    expect(characterFormSchema.safeParse(input).success).toBe(false)
    expect(characterEditSchema(legacy).safeParse(input).success).toBe(true)
  })

  it('omits unchanged languages from the PATCH', () => {
    const input = toInput({ ...draftFrom(legacy, 'x'), temperature: 0.8 })
    const patch = toCharacterPatch(input, legacy)
    expect(patch).not.toHaveProperty('sourceLanguage')
    expect(patch).not.toHaveProperty('targetLanguage')
    expect(patch.temperature).toBe(0.8)
  })

  it('sends and validates a language the user changed', () => {
    const input = toInput({
      ...draftFrom(legacy, 'x'),
      targetLanguage: 'ja-JP',
    })
    expect(characterEditSchema(legacy).safeParse(input).success).toBe(true)
    expect(toCharacterPatch(input, legacy)).toMatchObject({
      targetLanguage: 'ja-JP',
    })
    expect(toCharacterPatch(input, legacy)).not.toHaveProperty('sourceLanguage')
  })

  it('rejects switching to a different unsupported language', () => {
    const input = toInput({
      ...draftFrom(legacy, 'x'),
      targetLanguage: 'de-DE',
    })
    expect(
      characterEditSchema(legacy).safeParse(input).error?.issues[0]?.message,
    ).toBe('Choose Simplified Chinese, Traditional Chinese, Thai or Japanese')
  })
})
