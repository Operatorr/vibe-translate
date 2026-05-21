import type { Client } from 'pg'

import { sha256Hex } from './embeddings'
import type { Persona, SegmentToken, VibeStop } from './schemas'

// Only canonical requests are eligible for the shared cache: empty persona,
// empty instructions, default temperature. See adr/0004.
const DEFAULT_TEMPERATURE = 0.4

export type CanonicalityInput = {
  persona?: Persona
  instructions?: string
  temperature: number
}

export function isCanonical({ persona, instructions, temperature }: CanonicalityInput): boolean {
  const hasPersona =
    !!persona &&
    (!!persona.age ||
      !!persona.region ||
      !!persona.formality ||
      (persona.traits?.length ?? 0) > 0)
  const hasInstructions = !!instructions && instructions.trim().length > 0
  return !hasPersona && !hasInstructions && temperature === DEFAULT_TEMPERATURE
}

export type FingerprintInput = {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  vibe: VibeStop
  modelId: string
}

// Stable key for a canonical translation. Newlines separate fields so values
// can't collide across boundaries.
export function fingerprint(input: FingerprintInput): Promise<string> {
  return sha256Hex(
    [
      input.sourceText,
      input.sourceLanguage,
      input.targetLanguage,
      input.vibe,
      input.modelId,
    ].join('\n'),
  )
}

export type CacheHit = {
  targetText: string
  tokenAlignment: SegmentToken[]
  sourceEmbedding: number[] | null
}

export async function lookupCache(db: Client, fp: string): Promise<CacheHit | null> {
  const result = await db.query<{
    target_text: string
    token_alignment: SegmentToken[]
    source_embedding: number[] | null
  }>(
    `update translation_cache
        set hits = hits + 1, last_used_at = now()
      where fingerprint = $1
      returning target_text, token_alignment, source_embedding`,
    [fp],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    targetText: row.target_text,
    tokenAlignment: row.token_alignment,
    sourceEmbedding: row.source_embedding,
  }
}

export type CacheUpsertInput = FingerprintInput & {
  targetText: string
  tokenAlignment: SegmentToken[]
  sourceEmbedding: number[] | null
}

export async function upsertCache(db: Client, fp: string, input: CacheUpsertInput): Promise<void> {
  await db.query(
    `insert into translation_cache
       (fingerprint, source_language, target_language, vibe, model_id,
        source_text, target_text, token_alignment, source_embedding)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (fingerprint) do nothing`,
    [
      fp,
      input.sourceLanguage,
      input.targetLanguage,
      input.vibe,
      input.modelId,
      input.sourceText,
      input.targetText,
      JSON.stringify(input.tokenAlignment),
      input.sourceEmbedding ? JSON.stringify(input.sourceEmbedding) : null,
    ],
  )
}
