import * as z from 'zod'

import { chatJson, type ProviderConfig } from './openrouter'
import { buildExplainMessages, isJapaneseTarget } from './prompts'
import type { Persona } from './schemas'

// Bump when the Explain payload shape changes. Cached rows below this version
// are re-generated on demand. See docs/adr/0002.
export const EXPLAIN_PAYLOAD_VERSION = 1

export type ExplainGenerateInput = {
  sourceText: string
  sourceLanguage: string
  targetText: string
  targetLanguage: string
  persona: Persona
}

export type ExplainPayload = {
  version: number
  body: Record<string, unknown>
  tokenUsage: {
    modelId: string
    promptTokens: number
    completionTokens: number
  }
}

// Strict structured-output schemas. Like the translate schema, these use
// strictObject + sentinels ('' / []) rather than .optional(): strict json_schema
// requires every key present and additionalProperties:false. The field lists
// mirror the prompt built in api/_lib/prompts.ts → buildExplainMessages.

const literalGlossSchema = z.strictObject({ token: z.string(), gloss: z.string() })

// Generic fallback for non-Japanese targets: romaji/transliteration, a
// word-by-word gloss, and grammar notes.
const explainBodyGenericSchema = z.strictObject({
  romaji: z.string(),
  literalGloss: z.array(literalGlossSchema),
  grammarPatterns: z.array(z.strictObject({ pattern: z.string(), note: z.string() })),
})

// Japanese targets get the full pedagogical breakdown (PRODUCT.md): morphemes,
// per-kanji readings/radicals/JLPT, and dialect-aware grammar notes.
const explainBodyJaSchema = z.strictObject({
  romaji: z.string(),
  literalGloss: z.array(literalGlossSchema),
  morphemes: z.array(
    z.strictObject({
      surface: z.string(),
      base: z.string(),
      reading: z.string(),
      role: z.enum(['verb', 'noun', 'particle', 'aux', 'adjective', 'adverb', 'punct', 'other']),
      inflection: z.string(),
    }),
  ),
  kanji: z.array(
    z.strictObject({
      char: z.string(),
      on: z.array(z.string()),
      kun: z.array(z.string()),
      radicals: z.array(z.string()),
      strokeCount: z.number().int(),
      jlpt: z.string(),
    }),
  ),
  grammarPatterns: z.array(
    z.strictObject({ pattern: z.string(), note: z.string(), dialectNote: z.string() }),
  ),
})

// Language-aware Explain generation. One OpenRouter call returns the breakdown
// as strict JSON; the route handler caches it in `explains`. The payload shape
// varies per `targetLanguage` (Japanese gets kanji + JLPT + grammar patterns;
// other languages get a lighter scaffold). See docs/BACKEND.md and adr/0002.
export async function generateExplain(
  input: ExplainGenerateInput,
  config: ProviderConfig,
): Promise<ExplainPayload> {
  const japanese = isJapaneseTarget(input.targetLanguage)

  const { data, tokenUsage } = japanese
    ? await chatJson({
        apiKey: config.apiKey,
        model: config.modelId,
        appUrl: config.appUrl,
        messages: buildExplainMessages(input),
        schema: explainBodyJaSchema,
        schemaName: 'vibe_explain_ja',
        label: 'Explain',
        reasoning: config.reasoning,
      })
    : await chatJson({
        apiKey: config.apiKey,
        model: config.modelId,
        appUrl: config.appUrl,
        messages: buildExplainMessages(input),
        schema: explainBodyGenericSchema,
        schemaName: 'vibe_explain_generic',
        label: 'Explain',
        reasoning: config.reasoning,
      })

  return {
    version: EXPLAIN_PAYLOAD_VERSION,
    body: data as Record<string, unknown>,
    tokenUsage: {
      modelId: tokenUsage.modelId,
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
    },
  }
}
