import type { TranslateSegmentInput } from './ai'
import type { ExplainGenerateInput } from './explain'
import { VIBE_STOPS } from './schemas'
import type { Persona, VibeStop } from './schemas'

// Prompt construction for the translate flow. Pure and network-free so it can
// be unit-tested in isolation; `api/_lib/ai.ts` owns the OpenRouter call and
// consumes the messages built here. See docs/BACKEND.md.

// Model-facing register guidance, one line per Vibe stop. Deliberately English
// (the model is multilingual and renders the register in whatever target
// language is requested) and deliberately generic — the per-language labels and
// marketing hints live in the frontend `VIBE_PRESETS_PER_LANG`, not here.
//
// Typed `Record<VibeStop, string>` so adding a stop to VIBE_STOPS without a
// description here is a compile error. Keeps the six-stop contract in lockstep
// with api/_lib/schemas.ts → VIBE_STOPS and the DB `vibe_stop` enum.
const VIBE_REGISTER: Record<VibeStop, string> = {
  yakuza: 'Rough, aggressive, hyper-masculine street register; blunt slang, dropped politeness, intimidating.',
  friend: 'Warm casual register between close friends; relaxed contractions, familiar particles, easy banter.',
  casual: 'Everyday neutral-casual register; plain form, conversational but not slangy.',
  keigo: 'Standard polite / business register; teineigo (です・ます equivalents), respectful but not deferential.',
  keigoplus:
    'Elevated honorific register; humble + exalted forms (sonkeigo + kenjougo equivalents), deferential toward a superior.',
  emperor: 'Maximally grandiose, archaic, ceremonial register; ornate, lofty, imperial phrasing.',
}

// Belt-and-suspenders runtime guard for the lockstep invariant above; cheap and
// catches an out-of-sync map even if the type check is somehow bypassed.
const MISSING_REGISTER = VIBE_STOPS.filter((stop) => !(stop in VIBE_REGISTER))
if (MISSING_REGISTER.length > 0) {
  throw new Error(`VIBE_REGISTER is missing guidance for: ${MISSING_REGISTER.join(', ')}`)
}

// Render the structured Persona block into short prompt lines, omitting any
// empty field. Returns '' when the persona carries nothing.
export function formatPersona(persona: Persona): string {
  const lines: string[] = []
  if (persona.age) lines.push(`- Age: ${persona.age}`)
  if (persona.region) lines.push(`- Region/dialect: ${persona.region}`)
  if (persona.formality) lines.push(`- Formality: ${persona.formality}`)
  if (persona.traits.length > 0) lines.push(`- Traits: ${persona.traits.join(', ')}`)
  return lines.join('\n')
}

export type ChatMessage = { role: 'system' | 'user'; content: string }

// Build the two-message prompt for one translation. The system message is the
// stable instruction surface (register, persona, output contract, alignment
// rules); the user message is just the raw source text.
export function buildTranslateMessages(input: TranslateSegmentInput): ChatMessage[] {
  const persona = formatPersona(input.persona)
  const instructions = input.instructions?.trim()

  const system = [
    `You are an expert translator for a language-learning app.`,
    `Translate from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    ``,
    `REGISTER (vibe = "${input.vibe}"): ${VIBE_REGISTER[input.vibe]}`,
    persona ? `\nSPEAKER PERSONA (who is speaking / being addressed):\n${persona}` : null,
    instructions ? `\nADDITIONAL INSTRUCTIONS:\n${instructions}` : null,
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
export function buildExplainMessages(input: ExplainGenerateInput): ChatMessage[] {
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
    `You convert a free-form description of who someone is translating for into a`,
    `structured Character draft for a translation app. Infer what you safely can;`,
    `use null for anything not stated or reasonably implied.`,
    ``,
    `Respond with JSON only, matching the provided schema:`,
    `- "ok": true if you extracted anything useful; false if the description is unusable.`,
    `- "name": the addressee's name, or null.`,
    `- "sourceLanguage" / "targetLanguage": BCP-47 codes (e.g. "en-US", "ja-JP"), or null.`,
    `  The source is the user's own language; the target is who they are writing to.`,
    `- "defaultVibe": one of ${VIBE_STOPS.join(', ')} — the social register that best fits the`,
    `  relationship (e.g. a close friend -> "friend"; a boss or business contact -> "keigo").`,
    `- "temperature": 0.0-1.0 creativity (lower = more literal/formal), or null if unsure.`,
    `- "persona": { "age", "region", "formality", "traits" (array) }; null fields where unknown,`,
    `  "traits" is [] when none.`,
    `- "instructions": a short free-form note capturing relationship/context worth keeping`,
    `  (e.g. "college roommate in Osaka, uses Kansai-ben"), or null.`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
}
