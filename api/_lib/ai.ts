import { HTTPException } from 'hono/http-exception'
import * as z from 'zod'

import { chatJson, type ProviderConfig, type TokenUsage } from './openrouter'
import { buildDictationMessages, buildTranslateMessages } from './prompts'
import { VIBE_STOPS, segmentTokenSchema } from './schemas'
import type { CharacterDraft, Persona, SegmentToken, VibeStop } from './schemas'

export type TranslationProviderResult = {
  targetText: string
  tokenAlignment: SegmentToken[]
  tokenUsage: {
    modelId: string
    promptTokens: number
    completionTokens: number
    costCents?: number
  }
}

export type TranslateSegmentInput = {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  vibe: VibeStop
  temperature: number
  persona: Persona
  // Free-form system-prompt extension from the Character.
  instructions?: string
}

// Strict structured-output schema for a translation. The model returns
// `tokens`; we expose it as `tokenAlignment`. strictObject + required fields
// satisfy OpenRouter's strict json_schema mode. The join-equality invariant is
// enforced separately in `finalizeTokens` — a schema cannot express it.
const translateOutputSchema = z.strictObject({
  targetText: z.string(),
  tokens: z.array(segmentTokenSchema),
})

// Enforce the reconstruction invariant. A valid translation is never discarded
// for imperfect alignment: if the tokens don't reproduce `targetText`, degrade
// to a single whole-string token so the Segment still renders (hover just
// highlights everything). See adr/0006.
export function finalizeTokens(
  data: { targetText: string; tokens: SegmentToken[] },
  input: TranslateSegmentInput,
): { targetText: string; tokens: SegmentToken[] } {
  const { targetText, tokens } = data
  if (targetText.trim().length === 0) {
    throw new HTTPException(502, { message: 'Translation provider returned empty text' })
  }
  const reconstructs = tokens.length > 0 && tokens.map((token) => token.t).join('') === targetText
  return {
    targetText,
    tokens: reconstructs ? tokens : [{ t: targetText, src: input.sourceText }],
  }
}

// Synchronous translate-and-return path. One OpenRouter call (via chatJson)
// returns the translation and its per-token alignment as strict JSON; the route
// handler writes a Segment row. See docs/BACKEND.md and adr/0001, adr/0006.
export async function translateSegment(
  input: TranslateSegmentInput,
  config: ProviderConfig,
): Promise<TranslationProviderResult> {
  const { data, tokenUsage } = await chatJson({
    apiKey: config.apiKey,
    model: config.modelId,
    appUrl: config.appUrl,
    messages: buildTranslateMessages(input),
    schema: translateOutputSchema,
    schemaName: 'vibe_translation',
    temperature: input.temperature,
    label: 'Translation',
    reasoning: config.reasoning,
  })

  const { targetText, tokens } = finalizeTokens(data, input)
  return { targetText, tokenAlignment: tokens, tokenUsage }
}

// Best-effort structured output from the dictation model. Uses nullable fields
// (not .optional()) so the strict json_schema always carries every key; nulls /
// empties are dropped when mapped to a CharacterDraft.
const dictationOutputSchema = z.strictObject({
  ok: z.boolean(),
  name: z.string().nullable(),
  sourceLanguage: z.string().nullable(),
  targetLanguage: z.string().nullable(),
  defaultVibe: z.enum(VIBE_STOPS).nullable(),
  temperature: z.number().nullable(),
  persona: z
    .strictObject({
      age: z.string().nullable(),
      region: z.string().nullable(),
      formality: z.string().nullable(),
      traits: z.array(z.string()),
    })
    .nullable(),
  instructions: z.string().nullable(),
})

const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i

function cleanLocale(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed && LOCALE_RE.test(trimmed) ? trimmed : undefined
}

function cleanString(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

// Map the model's nullable output onto the public CharacterDraft, dropping
// nulls/empties and clamping out-of-range values rather than rejecting the
// whole draft — dictation is best-effort and the client confirms it anyway.
function toCharacterDraft(raw: z.infer<typeof dictationOutputSchema>): CharacterDraft {
  if (!raw.ok) return { ok: false }

  const draft: CharacterDraft = { ok: true }

  const name = cleanString(raw.name)
  if (name) draft.name = name.slice(0, 80)

  const sourceLanguage = cleanLocale(raw.sourceLanguage)
  if (sourceLanguage) draft.sourceLanguage = sourceLanguage

  const targetLanguage = cleanLocale(raw.targetLanguage)
  if (targetLanguage) draft.targetLanguage = targetLanguage

  if (raw.defaultVibe) draft.defaultVibe = raw.defaultVibe

  if (typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)) {
    draft.temperature = Math.min(1, Math.max(0, raw.temperature))
  }

  if (raw.persona) {
    const persona: Persona = { traits: raw.persona.traits.map((t) => t.trim()).filter(Boolean) }
    const age = cleanString(raw.persona.age)
    const region = cleanString(raw.persona.region)
    const formality = cleanString(raw.persona.formality)
    if (age) persona.age = age
    if (region) persona.region = region
    if (formality) persona.formality = formality
    if (persona.age || persona.region || persona.formality || persona.traits.length > 0) {
      draft.persona = persona
    }
  }

  const instructions = cleanString(raw.instructions)
  if (instructions) draft.instructions = instructions.slice(0, 2000)

  return draft
}

// Onboarding/in-app dictation: parse a free-form description ("text my friend
// Tomoko in Tokyo casually in Japanese") into a Character draft. The client
// pre-fills the confirmation form with whatever was extracted; `ok: false`
// signals the parse failed and the UI should fall back to the empty form — so a
// provider error is swallowed into `{ ok: false }` rather than surfaced as 5xx.
// `tokenUsage` is returned on success so the credit-charged route can bill it.
// Uses the `dictation` model registry task. See docs/PRODUCT.md.
export async function draftCharacterFromDictation(
  prompt: string,
  config: ProviderConfig,
): Promise<{ draft: CharacterDraft; tokenUsage?: TokenUsage }> {
  try {
    const { data, tokenUsage } = await chatJson({
      apiKey: config.apiKey,
      model: config.modelId,
      appUrl: config.appUrl,
      messages: buildDictationMessages(prompt),
      schema: dictationOutputSchema,
      schemaName: 'vibe_character_draft',
      label: 'Dictation',
      reasoning: config.reasoning,
    })
    return { draft: toCharacterDraft(data), tokenUsage }
  } catch {
    // Any provider/parse failure degrades to the empty-form fallback.
    return { draft: { ok: false } }
  }
}
