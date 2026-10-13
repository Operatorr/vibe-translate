import type { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { TRANSLATE_PROMPT_REVISION } from '../prompts'
import { fingerprint, isCanonical, upsertCache } from '../translation-cache'

// Canonicality gates the shared cross-user cache (adr/0004): anything that can
// shape the translate prompt must make a request non-canonical.
describe('isCanonical', () => {
  const base = { persona: { traits: [] }, temperature: 0.4 }

  it('accepts an empty persona, no instructions, default temperature', () => {
    expect(isCanonical(base)).toBe(true)
    expect(isCanonical({ temperature: 0.4 })).toBe(true)
  })

  it.each([
    ['age', { age: '60s', traits: [] }],
    ['region', { region: 'Osaka', traits: [] }],
    ['formality', { formality: 'blunt', traits: [] }],
    ['traits', { traits: ['warm'] }],
    ['tone', { tone: 'warm', traits: [] }],
    ['verbosity', { verbosity: 0.8, traits: [] }],
    // 0 is a real setting ("terse"), not an absent one.
    ['verbosity = 0', { verbosity: 0, traits: [] }],
  ])('rejects a persona with %s', (_label, persona) => {
    expect(isCanonical({ ...base, persona })).toBe(false)
  })

  it('treats a blank tone as absent', () => {
    expect(isCanonical({ ...base, persona: { tone: '', traits: [] } })).toBe(
      true,
    )
  })

  it('rejects instructions and non-default temperature', () => {
    expect(isCanonical({ ...base, instructions: 'tease a little' })).toBe(false)
    expect(isCanonical({ ...base, instructions: '   ' })).toBe(true)
    expect(isCanonical({ ...base, temperature: 0.9 })).toBe(false)
  })
})

// A canonical-prompt change must not keep serving results generated under the
// previous prompt, so the revision is part of the key.
describe('fingerprint', () => {
  const input = {
    sourceText: 'See you tomorrow.',
    sourceLanguage: 'en-US',
    targetLanguage: 'zh-TW',
    vibe: 'casual' as const,
    perspective: 'to' as const,
    modelId: 'openai/gpt-5-mini',
  }

  it('is stable for the same input and revision', async () => {
    expect(await fingerprint(input)).toBe(
      await fingerprint(input, TRANSLATE_PROMPT_REVISION),
    )
  })

  // Speaking as and to the same stop are different translations (adr/0009).
  it('changes with the perspective', async () => {
    expect(await fingerprint(input)).not.toBe(
      await fingerprint({ ...input, perspective: 'as' }),
    )
  })

  it('changes when the prompt revision changes', async () => {
    expect(await fingerprint(input, TRANSLATE_PROMPT_REVISION)).not.toBe(
      await fingerprint(input, TRANSLATE_PROMPT_REVISION - 1),
    )
  })
})

// Every key dimension (perspective included, adr/0009) must land in its own
// column; a swapped parameter would silently mislabel shared cache rows.
describe('upsertCache', () => {
  const input = {
    sourceText: 'See you tomorrow.',
    sourceLanguage: 'en-US',
    targetLanguage: 'ja-JP',
    vibe: 'emperor' as const,
    perspective: 'as' as const,
    modelId: 'openai/gpt-5-mini',
    targetText: 'また明日',
    tokenAlignment: [{ t: 'また明日', src: 'See you tomorrow.' }],
  }

  it.each([
    { label: 'an embedding', embedding: [0.1, 0.2], stored: '[0.1,0.2]' },
    { label: 'no embedding', embedding: null, stored: null },
  ])(
    'inserts every column in order ($label)',
    async ({ embedding, stored }) => {
      const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
        rows: [],
      }))
      await upsertCache({ query } as unknown as Client, 'fp', {
        ...input,
        sourceEmbedding: embedding,
      })
      const [sql, params] = query.mock.calls[0]
      expect(sql.replace(/\s+/g, ' ')).toContain(
        'insert into translation_cache (fingerprint, source_language, target_language, vibe, perspective, model_id, source_text, target_text, token_alignment, source_embedding) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (fingerprint) do nothing',
      )
      expect(params).toEqual([
        'fp',
        'en-US',
        'ja-JP',
        'emperor',
        'as',
        'openai/gpt-5-mini',
        'See you tomorrow.',
        'また明日',
        JSON.stringify(input.tokenAlignment),
        stored,
      ])
    },
  )
})
