import { describe, expect, it } from 'vitest'

import {
  buildDictationMessages,
  buildTranslateMessages,
  describeVerbosity,
  formatPersona,
} from '../prompts'

// Voice fields (tone, verbosity) and the code-span rule added with the app shell.
describe('persona voice fields', () => {
  it('renders tone and verbosity guidance', () => {
    const out = formatPersona({ tone: 'dry', verbosity: 0.1, traits: [] })
    expect(out).toContain('- Tone: dry')
    expect(out).toContain(`- Verbosity: ${describeVerbosity(0.1)}`)
  })

  it('renders verbosity 0 (terse) rather than dropping it', () => {
    expect(formatPersona({ verbosity: 0, traits: [] })).toContain(
      '- Verbosity: terse',
    )
  })

  it('omits absent voice fields', () => {
    expect(formatPersona({ traits: [] })).toBe('')
  })

  it('maps the slider onto four bands', () => {
    expect(describeVerbosity(0)).toMatch(/^terse/)
    expect(describeVerbosity(0.4)).toMatch(/^concise/)
    expect(describeVerbosity(0.6)).toMatch(/^balanced/)
    expect(describeVerbosity(1)).toMatch(/^expansive/)
  })
})

describe('translate prompt code spans', () => {
  it('tells the model to keep code verbatim as a single token', () => {
    const [system] = buildTranslateMessages({
      sourceText: 'Run `npm test` first',
      sourceLanguage: 'en-US',
      targetLanguage: 'ja-JP',
      vibe: 'casual',
      temperature: 0.4,
      persona: { traits: [] },
    })
    expect(system.content).toMatch(/backticks/)
    expect(system.content).toMatch(/verbatim/)
    expect(system.content).toMatch(/ONE token per code span/)
  })
})

describe('dictation prompt', () => {
  it('asks for tone and verbosity in the persona', () => {
    const [system] = buildDictationMessages('my dry, terse boss in Tokyo')
    expect(system.content).toContain('"tone"')
    expect(system.content).toContain('"verbosity"')
  })
})
