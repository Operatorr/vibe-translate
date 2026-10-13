import type { Perspective, Persona, VibeStop } from '@/lib/types'

// Client-side mirror of the server's translate prompt assembly
// (api/_lib/prompts.ts → buildTranslateMessages). Used ONLY for the live
// "compiled system prompt" preview in the character panel — the worker builds
// the real prompt. Keep the perspective and register lines and the persona
// formatting in step; app/lib/__tests__/system-prompt-parity.test.ts checks.

const VIBE_REGISTER: Record<VibeStop, Record<Perspective, string>> = {
  yakuza: {
    as: 'Rough, aggressive, hyper-masculine street register; blunt slang, rough self-reference, dropped politeness, intimidating.',
    to: 'Addressing a dangerous street tough; careful, respectful and never provocative, with polite forms or a junior’s deference to a senior. Do not mirror their slang or aggression.',
  },
  friend: {
    as: 'Warm casual register of a close friend; relaxed contractions, familiar particles, easy banter.',
    to: 'Addressing a close friend; warm casual register, relaxed contractions, familiar particles, easy banter.',
  },
  casual: {
    as: 'Everyday neutral-casual register; plain form, conversational but not slangy.',
    to: 'Addressing a peer or acquaintance; everyday neutral-casual register, plain form, conversational but not slangy.',
  },
  keigo: {
    as: 'Polite professional register, as staff or a business person speaks; teineigo (です・ます equivalents), courteous but not deferential.',
    to: 'Addressing a colleague, customer or stranger; standard polite register, teineigo (です・ます equivalents), respectful but not deferential.',
  },
  keigoplus: {
    as: 'Refined, elevated register of someone versed in etiquette; exalted forms for others and humble forms for themselves (sonkeigo + kenjougo equivalents), gracious and composed.',
    to: 'Addressing a superior (boss, client, elder); elevated honorific register, exalted forms for their actions and humble forms for the speaker’s own (sonkeigo + kenjougo equivalents), deferential.',
  },
  emperor: {
    as: 'A sovereign speaking; maximally grandiose, archaic, ceremonial register, imperial self-reference, speaks down to the listener, commands rather than requests, never humble.',
    to: 'Addressing royalty; the most exalted honorifics available (court-level, beyond business keigo), formal titles of address, extreme humility for the speaker, ceremonial and reverent.',
  },
}

// Who is talking in the translation. Always emitted (persona or not): it flips
// the register above, so canonical translations depend on it too.
const PERSPECTIVE_GUIDANCE: Record<Perspective, string> = {
  as: 'speaking AS the character. The source text is the character’s own words; translate it as the character would say it, in their voice, with their self-reference and way of talking. The register below is the character’s own.',
  to: 'speaking TO the character. The source text is the user’s own words, addressed to the character; translate it as the user would say it to them. The register below is how to address someone like the character. Never speak as the character: do not borrow their self-reference, attitude or status.',
}

const PERSONA_HEADING: Record<Perspective, string> = {
  as: 'CHARACTER PERSONA (the speaker; write in their voice):',
  to: 'CHARACTER PERSONA (the person being addressed, not the speaker):',
}

// How the persona applies, prefixed to VOICE_PRIORITY in the voice rules.
const PERSONA_ROLE: Record<Perspective, string> = {
  as: 'The persona describes the speaker: their age, region, personality, tone and traits shape the wording.',
  to: 'The persona describes the person being addressed: pitch the message to suit their age and personality, and write in their regional variety so it reads naturally to them. Tone, verbosity and style traits shape the user’s wording.',
}

export function describeVerbosity(value: number): string {
  if (value < 0.25) return 'terse — say the minimum, drop filler'
  if (value < 0.5) return 'concise — natural length, no padding'
  if (value < 0.75)
    return 'balanced — fuller phrasing while preserving the source meaning'
  return 'expansive — use fuller sentences without adding facts or explanations'
}

const CANTONESE = /cantonese|廣東話|广东话|粵語|粤语/i
const MANDARIN = /mandarin|國語|国语|普通話|普通话|華語|华语/i
const NEGATED_CANTONESE =
  /\b(?:not|no|non|without)[\s-]+(?:in[\s-]+)?cantonese|(?:不|唔|非)(?:說|说|講|讲|用)?(?:廣東話|广东话|粵語|粤语)/i

// Conservative: written Cantonese only when the region asks for Cantonese and
// neither negates it ("not Cantonese") nor also names Mandarin. Anything
// ambiguous falls back to Mandarin, which the guidance lets the persona override.
export function requestsCantonese(region: string | undefined): boolean {
  if (!region || !CANTONESE.test(region)) return false
  return !NEGATED_CANTONESE.test(region) && !MANDARIN.test(region)
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
    return requestsCantonese(persona.region)
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
  perspective: Perspective
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
    `PERSPECTIVE: ${PERSPECTIVE_GUIDANCE[input.perspective]}`,
    `REGISTER (vibe = "${input.vibe}"): ${VIBE_REGISTER[input.vibe][input.perspective]}`,
    persona ? `\n${PERSONA_HEADING[input.perspective]}\n${persona}` : null,
    instructions ? `\nADDITIONAL INSTRUCTIONS:\n${instructions}` : null,
    persona || instructions
      ? `\nVOICE RULES: ${PERSONA_ROLE[input.perspective]} ${VOICE_PRIORITY}`
      : null,
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
