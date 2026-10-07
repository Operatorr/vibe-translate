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
  it('rejects unsupported input languages while allowing non-language edits to legacy Characters', () => {
    expect(
      characterCreateSchema.safeParse({ ...character, sourceLanguage: 'ko-KR' })
        .success,
    ).toBe(false)
    expect(characterUpdateSchema.safeParse({ temperature: 0.7 }).success).toBe(
      true,
    )
  })
})
