import { describe, expect, it } from 'vitest'

import type { TranslateSegmentInput } from '../ai'
import type { ExplainGenerateInput } from '../explain'
import {
  buildDictationMessages,
  buildExplainMessages,
  buildTranslateMessages,
  formatPersona,
  isJapaneseTarget,
} from '../prompts'
import { VIBE_STOPS } from '../schemas'
import type { Persona } from '../schemas'

const baseInput = (overrides: Partial<TranslateSegmentInput> = {}): TranslateSegmentInput => ({
  sourceText: 'Hello grandma',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  vibe: 'casual',
  perspective: 'to',
  temperature: 0.4,
  persona: { traits: [] },
  ...overrides,
})

describe('formatPersona', () => {
  it('renders only the populated fields', () => {
    const persona: Persona = {
      age: '60s',
      region: 'Osaka',
      formality: 'warm but blunt',
      traits: ['warm', 'direct'],
    }
    const out = formatPersona(persona)
    expect(out).toContain('- Age: 60s')
    expect(out).toContain('- Region/dialect: Osaka')
    expect(out).toContain('- Formality: warm but blunt')
    expect(out).toContain('- Traits: warm, direct')
  })

  it('returns an empty string when the persona is empty', () => {
    expect(formatPersona({ traits: [] })).toBe('')
  })

  it('omits empty optional fields', () => {
    const out = formatPersona({ region: 'Tokyo', traits: [] })
    expect(out).toBe('- Region/dialect: Tokyo')
  })
})

describe('buildTranslateMessages', () => {
  it('emits a system message and a user message of just the source text', () => {
    const messages = buildTranslateMessages(baseInput({ sourceText: 'Good morning' }))
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'Good morning' })
  })

  it('includes the language pair, the alignment hard rules, and the one-shot example', () => {
    const system = buildTranslateMessages(baseInput()).find((m) => m.role === 'system')!.content
    expect(system).toContain('from en-US to ja-JP')
    expect(system).toContain('HARD RULES')
    expect(system).toContain('reproduce')
    expect(system).toContain('忘れんように') // worked example anchors token granularity
  })

  it('includes register guidance for every Vibe stop', () => {
    for (const stop of VIBE_STOPS) {
      const system = buildTranslateMessages(baseInput({ vibe: stop })).find(
        (m) => m.role === 'system',
      )!.content
      const marker = `REGISTER (vibe = "${stop}"):`
      expect(system).toContain(marker)
      // Guidance text follows the marker on the same line and is non-empty.
      const line = system.split('\n').find((l) => l.includes(marker))!
      expect(line.slice(line.indexOf(marker) + marker.length).trim().length).toBeGreaterThan(10)
    }
  })

  it('includes the persona block only when populated', () => {
    const withPersona = buildTranslateMessages(
      baseInput({ persona: { age: '20s', traits: [] } }),
    ).find((m) => m.role === 'system')!.content
    expect(withPersona).toContain('CHARACTER PERSONA')
    expect(withPersona).toContain('- Age: 20s')

    const without = buildTranslateMessages(baseInput()).find((m) => m.role === 'system')!.content
    expect(without).not.toContain('CHARACTER PERSONA')
  })

  describe('perspective', () => {
    const system = (overrides: Partial<TranslateSegmentInput>) =>
      buildTranslateMessages(baseInput(overrides)).find(
        (m) => m.role === 'system',
      )!.content
    const register = (text: string) =>
      text.split('\n').find((l) => l.startsWith('REGISTER'))

    it('is stated even without a persona, since it changes the register', () => {
      expect(system({ perspective: 'as' })).toContain(
        'PERSPECTIVE: speaking AS the character',
      )
      expect(system({ perspective: 'to' })).toContain(
        'PERSPECTIVE: speaking TO the character',
      )
    })

    it.each(['yakuza', 'keigoplus', 'emperor'] as const)(
      'gives %s different register guidance as and to the character',
      (vibe) => {
        expect(register(system({ vibe, perspective: 'as' }))).not.toBe(
          register(system({ vibe, perspective: 'to' })),
        )
      },
    )

    it('frames the persona as the speaker or the addressee', () => {
      const persona = { age: '70s', traits: [] }
      const as = system({ perspective: 'as', persona })
      const to = system({ perspective: 'to', persona })
      expect(as).toContain('CHARACTER PERSONA (the speaker')
      expect(as).toContain('The persona describes the speaker')
      expect(to).toContain(
        'CHARACTER PERSONA (the person being addressed, not the speaker)',
      )
      expect(to).toContain('The persona describes the person being addressed')
    })

    it('never lets a "to" translation speak as the character', () => {
      expect(system({ vibe: 'emperor', perspective: 'to' })).toContain(
        'Never speak as the character',
      )
    })
  })

  it('appends free-form instructions only when present', () => {
    const withInstr = buildTranslateMessages(
      baseInput({ instructions: '  Use Kansai-ben.  ' }),
    ).find((m) => m.role === 'system')!.content
    expect(withInstr).toContain('ADDITIONAL INSTRUCTIONS')
    expect(withInstr).toContain('Use Kansai-ben.')

    const without = buildTranslateMessages(baseInput({ instructions: '   ' })).find(
      (m) => m.role === 'system',
    )!.content
    expect(without).not.toContain('ADDITIONAL INSTRUCTIONS')
  })
})

const explainInput = (overrides: Partial<ExplainGenerateInput> = {}): ExplainGenerateInput => ({
  sourceText: 'Good morning',
  sourceLanguage: 'en-US',
  targetText: 'おはようございます',
  targetLanguage: 'ja-JP',
  persona: { traits: [] },
  ...overrides,
})

describe('isJapaneseTarget', () => {
  it('matches Japanese locales regardless of region/case', () => {
    expect(isJapaneseTarget('ja')).toBe(true)
    expect(isJapaneseTarget('ja-JP')).toBe(true)
    expect(isJapaneseTarget('JA-jp')).toBe(true)
  })
  it('rejects non-Japanese locales', () => {
    expect(isJapaneseTarget('en-US')).toBe(false)
    expect(isJapaneseTarget('fr')).toBe(false)
  })
})

describe('buildExplainMessages', () => {
  it('asks for the full kanji/morpheme breakdown for Japanese targets', () => {
    const system = buildExplainMessages(explainInput()).find((m) => m.role === 'system')!.content
    expect(system).toContain('"romaji"')
    expect(system).toContain('"morphemes"')
    expect(system).toContain('"kanji"')
    expect(system).toContain('en-US') // gloss in the learner's language
  })
  it('uses the lighter scaffold (no kanji) for non-Japanese targets', () => {
    const system = buildExplainMessages(
      explainInput({ targetLanguage: 'fr-FR', targetText: 'Bonjour' }),
    ).find((m) => m.role === 'system')!.content
    expect(system).toContain('"literalGloss"')
    expect(system).not.toContain('"kanji"')
  })
  it('puts the target text in the user message', () => {
    const messages = buildExplainMessages(explainInput())
    expect(messages[1]).toEqual({ role: 'user', content: 'おはようございます' })
  })
})

describe('buildDictationMessages', () => {
  it('lists every Vibe stop and the draft fields, with the prompt as the user message', () => {
    const messages = buildDictationMessages('text my friend Tomoko in Tokyo')
    const system = messages[0].content
    for (const stop of VIBE_STOPS) expect(system).toContain(stop)
    expect(system).toContain('"ok"')
    expect(system).toContain('"defaultVibe"')
    expect(messages[1]).toEqual({ role: 'user', content: 'text my friend Tomoko in Tokyo' })
  })

  // A Character may be spoken as or to (adr/0009), so no field may assume an
  // addressee; the register is read per perspective.
  it('describes the draft fields without assuming an addressee', () => {
    const system = buildDictationMessages(
      'I want to sound like a yakuza',
    )[0].content.replace(/\s+/g, ' ')
    expect(system).toContain(`"name": the Character's name`)
    expect(system).toContain('the target is the output language')
    expect(system).toContain(
      'When the user speaks as the Character, it is how the Character talks',
    )
    expect(system).toContain(
      'When the user writes to the Character, it is the register for addressing them',
    )
    expect(system).not.toMatch(/addressee|who they are writing to/)
  })
})
