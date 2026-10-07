import { describe, expect, it } from 'vitest'

// The one sanctioned cross-boundary import: the client prompt preview mirrors
// the worker's prompt, and this test is what keeps the two in step.
import * as server from '@api/_lib/prompts'
import { CHARACTER_LANGUAGES } from '../character-options'
import * as client from '../system-prompt'

const REGIONS = [
  undefined,
  'Taichung',
  'Hong Kong (Cantonese)',
  'Guangzhou (Cantonese)',
  'Hong Kong (Mandarin, not Cantonese)',
  'Chiang Mai (North)',
]

describe('client prompt preview matches the worker prompt', () => {
  it.each(CHARACTER_LANGUAGES.flatMap((lang) => REGIONS.map((r) => [lang, r])))(
    'language guidance for %s / %s',
    (lang, region) => {
      const persona = { region, traits: [] }
      expect(client.targetLanguageGuidance(lang!, persona)).toBe(
        server.targetLanguageGuidance(lang!, persona),
      )
    },
  )

  it.each([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 1])(
    'verbosity band at %s',
    (value) => {
      expect(client.describeVerbosity(value)).toBe(
        server.describeVerbosity(value),
      )
    },
  )

  it('formats the persona identically', () => {
    const persona = {
      age: '60s',
      region: 'Osaka (Kansai)',
      formality: 'very formal',
      tone: 'warm',
      verbosity: 0,
      traits: ['blunt', 'dialect: kansai-ben'],
    }
    expect(client.formatPersona(persona)).toBe(server.formatPersona(persona))
  })

  it('carries the same register, persona and priority sections', () => {
    const input = {
      sourceLanguage: 'en-US',
      targetLanguage: 'zh-TW',
      vibe: 'keigo' as const,
      temperature: 0.4,
      persona: { region: 'Hong Kong (Cantonese)', tone: 'warm', traits: [] },
      instructions: 'Keep it short.',
    }
    const preview = client.compileSystemPrompt({ name: 'Lin', ...input })
    const [system] = server.buildTranslateMessages({
      sourceText: 'Hi',
      ...input,
    })
    // Everything from the language line through the voice rules is shared;
    // only the output contract below it is abbreviated in the preview.
    const shared = (text: string) =>
      text.slice(text.indexOf('Translate from'), text.indexOf('VOICE RULES'))
    expect(shared(preview)).toBe(shared(system.content))
    const voiceRules = (text: string) =>
      text.split('\n').find((line) => line.startsWith('VOICE RULES'))
    expect(voiceRules(preview)).toBe(voiceRules(system.content))
  })
})
