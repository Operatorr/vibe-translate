import { describe, expect, it } from 'vitest'

import {
  VIBE_PRESETS_DEFAULT,
  getVibesForLang,
  vibeDetailParts,
} from '@/components/vibe-design/design-data'
import { CHARACTER_LANGUAGES, SOURCE_LANGUAGES } from '../character-options'
import { VIBE_STOPS } from '../schemas'

// The six Vibe stop IDs are a contract with the DB enum and the worker; the
// slider indexes presets by position, so order matters too.
describe('per-language Vibe presets', () => {
  it.each(CHARACTER_LANGUAGES)(
    '%s lists exactly the six canonical stops in slider order',
    (code) => {
      expect(getVibesForLang(code).map((v) => v.id)).toEqual([...VIBE_STOPS])
    },
  )

  it.each(CHARACTER_LANGUAGES)(
    '%s names each stop in the target language rather than the English fallback',
    (code) => {
      expect(getVibesForLang(code)).not.toBe(VIBE_PRESETS_DEFAULT)
      expect(getVibesForLang(code).map((v) => v.native)).not.toEqual(
        VIBE_PRESETS_DEFAULT.map((v) => v.native),
      )
    },
  )

  // The slider is read before the target is: labels follow the source language.
  it.each(CHARACTER_LANGUAGES)(
    '%s is labelled in English by default',
    (code) => {
      for (const v of getVibesForLang(code)) {
        expect(v.label).toMatch(/^[A-Za-z+ ]+$/)
      }
    },
  )

  it.each(SOURCE_LANGUAGES.filter((code) => code !== 'en-US'))(
    'a %s source localizes labels and keeps the target term',
    (source) => {
      const english = getVibesForLang('zh-TW')
      const local = getVibesForLang('zh-TW', source)
      expect(local.map((v) => v.id)).toEqual([...VIBE_STOPS])
      expect(local.map((v) => v.native)).toEqual(english.map((v) => v.native))
      expect(local.map((v) => v.label)).not.toEqual(english.map((v) => v.label))
    },
  )

  it('heads the active stop with label, target term, and hint', () => {
    const keigo = getVibesForLang('ja-JP').find((v) => v.id === 'keigo')!
    expect(vibeDetailParts(keigo)).toEqual([
      'Keigo',
      '丁寧語',
      'standard polite',
    ])
    const polite = getVibesForLang('en-US').find((v) => v.id === 'keigo')!
    expect(vibeDetailParts(polite)).toEqual(['Polite', 'docs default'])
  })
})
