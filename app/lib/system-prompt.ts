import type { Persona, VibeStop } from '@/lib/types'

// Client-side mirror of the server's translate prompt assembly
// (api/_lib/prompts.ts → buildTranslateMessages). Used ONLY for the live
// "compiled system prompt" preview in the character panel — the worker builds
// the real prompt. Keep the register lines and persona formatting in step.

const VIBE_REGISTER: Record<VibeStop, string> = {
  yakuza:
    'Rough, aggressive, hyper-masculine street register; blunt slang, dropped politeness, intimidating.',
  friend:
    'Warm casual register between close friends; relaxed contractions, familiar particles, easy banter.',
  casual:
    'Everyday neutral-casual register; plain form, conversational but not slangy.',
  keigo:
    'Standard polite / business register; teineigo (です・ます equivalents), respectful but not deferential.',
  keigoplus:
    'Elevated honorific register; humble + exalted forms (sonkeigo + kenjougo equivalents), deferential toward a superior.',
  emperor:
    'Maximally grandiose, archaic, ceremonial register; ornate, lofty, imperial phrasing.',
}

export function describeVerbosity(value: number): string {
  if (value < 0.25) return 'terse — say the minimum, drop filler'
  if (value < 0.5) return 'concise — natural length, no padding'
  if (value < 0.75)
    return 'balanced — fuller phrasing while preserving the source meaning'
  return 'expansive — use fuller sentences without adding facts or explanations'
}

// Script and spoken variety are separate: Cantonese can use traditional
// characters even when the speaker's region is Guangzhou.
export function targetLanguageGuidance(
  targetLanguage: string,
  persona: Persona,
): string | null {
  if (targetLanguage === 'zh-CN')
    return 'Use Mandarin in simplified characters, with vocabulary appropriate to the selected region.'
  if (targetLanguage === 'zh-TW') {
    const cantonese = /cantonese|廣東話|广东话|粵語|粤语/i.test(
      persona.region ?? '',
    )
    return cantonese
      ? 'Use written Cantonese in traditional characters, with vocabulary appropriate to the selected region. Do not switch to simplified characters for Guangzhou.'
      : 'Use Taiwanese Mandarin in traditional characters unless the persona explicitly requests another Chinese variety.'
  }
  if (targetLanguage === 'th-TH')
    return 'Use Thai script, with regional vocabulary appropriate to the selected region. Do not infer the speaker’s gender from the region.'
  return null
}

const VOICE_PRIORITY =
  'The selected vibe controls politeness and formality. Tone, traits, legacy formality notes and additional instructions must not override the selected register. Apply personality and regional vocabulary within that register. Do not add facts or omit source meaning to satisfy verbosity; temperature varies wording, not register.'

export function formatPersona(persona: Persona): string {
  const lines: string[] = []
  if (persona.age) lines.push(`- Age: ${persona.age}`)
  if (persona.region) lines.push(`- Region/dialect: ${persona.region}`)
  if (persona.formality) lines.push(`- Formality: ${persona.formality}`)
  if (persona.tone) lines.push(`- Tone: ${persona.tone}`)
  if (typeof persona.verbosity === 'number')
    lines.push(`- Verbosity: ${describeVerbosity(persona.verbosity)}`)
  if (persona.traits.length > 0)
    lines.push(`- Traits: ${persona.traits.join(', ')}`)
  return lines.join('\n')
}

export function compileSystemPrompt(input: {
  name: string
  sourceLanguage: string
  targetLanguage: string
  vibe: VibeStop
  temperature: number
  persona: Persona
  instructions?: string
}): string {
  const persona = formatPersona(input.persona)
  const instructions = input.instructions?.trim()
  return [
    `# Character: ${input.name || '(unnamed)'} · temperature ${input.temperature.toFixed(2)}`,
    `You are an expert translator for a language-learning app.`,
    `Translate from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    targetLanguageGuidance(input.targetLanguage, input.persona),
    ``,
    `REGISTER (vibe = "${input.vibe}"): ${VIBE_REGISTER[input.vibe]}`,
    persona
      ? `\nSPEAKER PERSONA (who is speaking / being addressed):\n${persona}`
      : null,
    instructions ? `\nADDITIONAL INSTRUCTIONS:\n${instructions}` : null,
    persona || instructions ? `\nVOICE RULES: ${VOICE_PRIORITY}` : null,
    ``,
    `Respond with JSON: "targetText" plus a word-level "tokens" alignment.`,
    ``,
    `HARD RULES:`,
    `- Tokens concatenate back to "targetText" exactly; punctuation is its own token.`,
    `- Segment at word / morpheme granularity.`,
    `- Code in backticks or a code fence is copied verbatim as ONE token — never split.`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}
