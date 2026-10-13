import type { TranslateSegmentInput } from './ai'
import type { ExplainGenerateInput } from './explain'
import {
  PERSPECTIVES,
  VIBE_STOPS,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
} from './schemas'
import type { Perspective, Persona, VibeStop } from './schemas'

// Prompt construction for the translate flow. Pure and network-free so it can
// be unit-tested in isolation; `api/_lib/ai.ts` owns the OpenRouter call and
// consumes the messages built here. See docs/BACKEND.md.

// Model-facing register guidance, one line per Vibe stop and Perspective.
// Deliberately English (the model is multilingual and renders the register in
// whatever target language is requested) and deliberately generic — the
// per-language labels and marketing hints live in the frontend
// `VIBE_PRESETS_PER_LANG`, not here.
//
// The same stop means different speech by Perspective: speaking AS a yakuza is
// rough street talk, speaking TO one is careful respect; AS an emperor is
// imperial condescension, TO one is the most exalted honorifics. The middle
// stops mostly converge. "The speaker" is the Character for `as` and the user
// for `to`. See adr/0009.
//
// Typed `Record<VibeStop, Record<Perspective, string>>` so adding a stop to
// VIBE_STOPS (or a perspective) without guidance here is a compile error. Keeps
// the six-stop contract in lockstep with api/_lib/schemas.ts → VIBE_STOPS and
// the DB `vibe_stop` enum.
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

// Belt-and-suspenders runtime guard for the lockstep invariant above; cheap and
// catches an out-of-sync map even if the type check is somehow bypassed.
const MISSING_REGISTER = VIBE_STOPS.flatMap((stop) =>
  PERSPECTIVES.filter((p) => !VIBE_REGISTER[stop]?.[p]).map(
    (p) => `${stop}/${p}`,
  ),
)
if (MISSING_REGISTER.length > 0) {
  throw new Error(
    `VIBE_REGISTER is missing guidance for: ${MISSING_REGISTER.join(', ')}`,
  )
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
// Render the structured Persona block into short prompt lines, omitting any
// empty field. Returns '' when the persona carries nothing.
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

// Map the 0..1 verbosity slider onto prompt-friendly guidance. Mirrored on the
// client in app/lib/system-prompt.ts for the live "compiled prompt" preview.
export function describeVerbosity(value: number): string {
  if (value < 0.25) return 'terse — say the minimum, drop filler'
  if (value < 0.5) return 'concise — natural length, no padding'
  if (value < 0.75)
    return 'balanced — fuller phrasing while preserving the source meaning'
  return 'expansive — use fuller sentences without adding facts or explanations'
}

export type ChatMessage = { role: 'system' | 'user'; content: string }

// Bump whenever the canonical translate prompt (no persona, no instructions)
// changes what the model is told. It is part of the shared translation-cache
// fingerprint, so a bump stops serving results produced under the old prompt.
// 2: script and variety guidance for zh-CN, zh-TW and th-TH targets.
// 3: perspective (as / to the Character) and per-perspective register lines.
export const TRANSLATE_PROMPT_REVISION = 3

// Build the two-message prompt for one translation. The system message is the
// stable instruction surface (perspective, register, persona, output contract,
// alignment rules); the user message is just the raw source text.
export function buildTranslateMessages(
  input: TranslateSegmentInput,
): ChatMessage[] {
  const persona = formatPersona(input.persona)
  const instructions = input.instructions?.trim()

  const system = [
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
    `Respond with JSON containing exactly two fields: "targetText" and "tokens".`,
    `- "targetText": the full translation, written entirely in the chosen register.`,
    `- "tokens": a word-level segmentation of EXACTLY "targetText". Each entry is`,
    `  { "t": <a target chunk>, "src": <the contiguous source span it renders, or ""> }.`,
    ``,
    `HARD RULES (a response that breaks these is unusable):`,
    `1. Concatenating every "t" in order, with nothing between them, MUST reproduce`,
    `   "targetText" exactly — every character, space, and punctuation mark. Do not`,
    `   drop, add, reorder, or alter anything.`,
    `2. For languages written with spaces, carry each token's spacing inside "t"`,
    `   (e.g. "t": "the "). For languages without spaces (e.g. Japanese), do not`,
    `   invent spaces.`,
    `3. Punctuation is its own token; its "src" is the matching source punctuation, or "".`,
    `4. "src" may be "" when a target token has no source counterpart (particles,`,
    `   inflection, politeness markers).`,
    `5. Segment at word / morpheme granularity — not whole phrases or whole sentences.`,
    `6. Anything wrapped in backticks or a \`\`\` code fence is code: copy it into`,
    `   "targetText" verbatim as exactly ONE token per code span ("src" = the same code).`,
    `   This overrides rule 5: never split a code span into words or morphemes.`,
    ``,
    `EXAMPLE (en-US → ja-JP, casual Kansai register):`,
    `source: "Could you write down your recipe so I don't forget?"`,
    `{"targetText":"忘れんように、レシピ書いといてくれへん？","tokens":[` +
      `{"t":"忘れんように","src":"so I don't forget"},` +
      `{"t":"、","src":","},` +
      `{"t":"レシピ","src":"recipe"},` +
      `{"t":"書いといて","src":"write down"},` +
      `{"t":"くれへん？","src":"could you"}]}`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: input.sourceText },
  ]
}

// True when the target language is Japanese (any region). Drives both the
// Explain prompt below and the output schema selected in api/_lib/explain.ts.
export function isJapaneseTarget(targetLanguage: string): boolean {
  return targetLanguage.trim().toLowerCase().startsWith('ja')
}

// Build the prompt for an Explain breakdown of a translated segment. Every
// gloss/note is written in the learner's source language. Japanese targets get
// the full kanji/morpheme/grammar treatment; other languages get a lighter
// scaffold. The schema in explain.ts mirrors these field lists. See PRODUCT.md.
export function buildExplainMessages(
  input: ExplainGenerateInput,
): ChatMessage[] {
  const common = [
    `You are a patient language tutor for a learner whose native language is ${input.sourceLanguage}.`,
    `Break down the following ${input.targetLanguage} text, translated from a ${input.sourceLanguage} source.`,
    `SOURCE: ${input.sourceText}`,
    `TARGET: ${input.targetText}`,
    ``,
    `Write every gloss, note, and explanation in ${input.sourceLanguage}.`,
    `Respond with JSON only, matching the provided schema exactly.`,
    ``,
    `Fields:`,
  ]

  const system = (
    isJapaneseTarget(input.targetLanguage)
      ? [
          ...common,
          `- "romaji": Hepburn romanisation of the entire TARGET.`,
          `- "literalGloss": array of { "token", "gloss" } covering the TARGET in order.`,
          `- "morphemes": array of { "surface", "base", "reading" (hiragana), "role", "inflection" }.`,
          `  "role" is one of verb, noun, particle, aux, adjective, adverb, punct, other.`,
          `  "inflection" is "" when the token is uninflected.`,
          `- "kanji": one entry per distinct kanji in the TARGET — { "char", "on" (ON readings),`,
          `  "kun" (KUN readings), "radicals", "strokeCount", "jlpt" (e.g. "N5", or "" if none) }.`,
          `- "grammarPatterns": array of { "pattern", "note", "dialectNote" }. "dialectNote" flags`,
          `  any dialect/register variation (e.g. Kansai-ben), or "" for standard usage.`,
        ]
      : [
          ...common,
          `- "romaji": a romanised/transliterated form of the TARGET, or "" if not applicable.`,
          `- "literalGloss": array of { "token", "gloss" } covering the TARGET in order.`,
          `- "grammarPatterns": array of { "pattern", "note" } for each notable construction.`,
        ]
  ).join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: input.targetText },
  ]
}

// Build the prompt that parses a free-form description into a Character draft.
// Output is best-effort: "ok": false (with null fields) signals an unusable
// prompt so the client can fall back to an empty form. See docs/PRODUCT.md.
export function buildDictationMessages(prompt: string): ChatMessage[] {
  const system = [
    `You convert a free-form description of a Character into a structured Character`,
    `draft for a translation app. A Character is either someone the user writes to, or`,
    `someone whose voice the user wants to speak in. Infer what you safely can; use`,
    `null for anything not stated or reasonably implied.`,
    ``,
    `Respond with JSON only, matching the provided schema:`,
    `- "ok": true if you extracted anything useful; false if the description is unusable.`,
    `- "name": the Character's name, or null.`,
    `- "sourceLanguage": one of ${SOURCE_LANGUAGES.join(', ')}, or null.`,
    `- "targetLanguage": one of ${TARGET_LANGUAGES.join(', ')}, or null.`,
    `  Use null for unsupported languages; never substitute a different language.`,
    `  The source is the language the user writes in; the target is the output language.`,
    `- "defaultVibe": one of ${VIBE_STOPS.join(', ')} — the register of the translation.`,
    `  When the user speaks as the Character, it is how the Character talks`,
    `  (e.g. a yakuza -> "yakuza"; an emperor -> "emperor"). When the user writes to the`,
    `  Character, it is the register for addressing them, set by the relationship`,
    `  (e.g. a close friend -> "friend"; a boss or business contact -> "keigo").`,
    `- "perspective": "as" when the user wants to speak in this person's own voice (as them),`,
    `  "to" when the user is writing to this person; null if unclear.`,
    `- "temperature": 0.0-1.0 wording variation (lower = more predictable; does not set formality), or null if unsure.`,
    `- "persona": { "age", "region", "formality", "tone", "verbosity", "traits" (array) }; null`,
    `  fields where unknown, "traits" is [] when none. "tone" is one word for how they sound`,
    `  (e.g. "warm", "dry", "playful"); "verbosity" is 0.0 (terse) to 1.0 (expansive).`,
    `  Only fill tone/verbosity when the description clearly implies them.`,
    `- "instructions": a short free-form note capturing relationship/context worth keeping`,
    `  (e.g. "college roommate in Osaka, uses Kansai-ben"), or null.`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
}
