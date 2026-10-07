import { describe, expect, it } from 'vitest'

import {
  VIBE_PRESETS_DEFAULT,
  getVibesForLang,
} from '@/components/vibe-design/design-data'
import { CHARACTER_LANGUAGES } from '../character-options'
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

  it.each(CHARACTER_LANGUAGES.filter((code) => code !== 'ja-JP'))(
    '%s has its own labels rather than the English fallback',
    (code) => {
      expect(getVibesForLang(code)).not.toBe(VIBE_PRESETS_DEFAULT)
      expect(getVibesForLang(code).map((v) => v.label)).not.toEqual(
        VIBE_PRESETS_DEFAULT.map((v) => v.label),
      )
    },
  )
})
