import { describe, expect, it } from 'vitest'
import {
  characterCreateSchema,
  characterUpdateSchema,
  TARGET_LANGUAGES,
} from '../schemas'

const character = {
  name: 'Lin',
  sourceLanguage: 'en-US',
  targetLanguage: 'zh-TW',
  persona: { region: 'Taichung', traits: ['occasional code-switch'] },
}

describe('supported Character languages', () => {
  it.each(TARGET_LANGUAGES)(
    'accepts English input and %s output with a custom region',
    (targetLanguage) => {
      expect(
        characterCreateSchema.parse({ ...character, targetLanguage }).persona
          .region,
      ).toBe('Taichung')
    },
  )
  it.each(['en-US', 'ko-KR', 'fr-FR'])(
    'rejects unsupported target %s on create and update',
    (targetLanguage) => {
      expect(
        characterCreateSchema.safeParse({ ...character, targetLanguage })
          .success,
      ).toBe(false)
      expect(characterUpdateSchema.safeParse({ targetLanguage }).success).toBe(
        false,
      )
    },
  )
  // Spelled out rather than imported so an accidental narrowing of
  // SOURCE_LANGUAGES (e.g. English-only) fails here.
  const SUPPORTED_SOURCES = ['en-US', 'zh-CN', 'zh-TW', 'th-TH', 'ja-JP']
  const SUPPORTED_TARGETS = ['zh-CN', 'zh-TW', 'th-TH', 'ja-JP']

  it.each(SUPPORTED_SOURCES)(
    'accepts %s as the input language on create and update',
    (sourceLanguage) => {
      expect(
        characterCreateSchema.parse({ ...character, sourceLanguage })
          .sourceLanguage,
      ).toBe(sourceLanguage)
      expect(characterUpdateSchema.parse({ sourceLanguage })).toEqual({
        sourceLanguage,
      })
    },
  )
  it.each(SUPPORTED_TARGETS)(
    'accepts %s as the output language on update',
    (targetLanguage) => {
      expect(characterUpdateSchema.parse({ targetLanguage })).toEqual({
        targetLanguage,
      })
    },
  )
  it.each(['ko-KR', 'fr-FR', 'en-GB'])(
    'rejects unsupported input %s on update',
    (sourceLanguage) => {
      expect(characterUpdateSchema.safeParse({ sourceLanguage }).success).toBe(
        false,
      )
    },
  )
  it('rejects unsupported input languages while allowing non-language edits to legacy Characters', () => {
    expect(
      characterCreateSchema.safeParse({ ...character, sourceLanguage: 'ko-KR' })
        .success,
    ).toBe(false)
    expect(characterUpdateSchema.safeParse({ temperature: 0.7 }).success).toBe(
      true,
    )
  })
  it('does not fill create-time defaults into a partial update', () => {
    // A temperature-only PATCH must leave the stored vibe and persona alone.
    expect(characterUpdateSchema.parse({ temperature: 0.7 })).toEqual({
      temperature: 0.7,
    })
  })
})
