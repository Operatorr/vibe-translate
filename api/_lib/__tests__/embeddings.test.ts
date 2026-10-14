import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMBEDDING_DIMENSIONS, embedText, formatVector, parseVector } from '../embeddings'

const vector = (n = EMBEDDING_DIMENSIONS) => Array.from({ length: n }, (_, i) => i / n)

const okResponse = (embedding: number[]) =>
  new Response(
    JSON.stringify({
      data: [{ embedding }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 7 },
    }),
    { status: 200 },
  )

describe('embedText', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the vector on the happy path and calls OpenRouter with the platform key', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(vector()))
    const result = await embedText({ text: 'good morning', apiKey: 'sk-platform' })
    expect(result.vector).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result.promptTokens).toBe(7)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('openrouter.ai')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-platform')
  })

  // The translate flow relies on these throwing so it can degrade to a null
  // source_embedding rather than discard a generated translation (adr/0006).
  it('throws 503 when no key is configured (e.g. BYOK-only deploy)', async () => {
    await expect(embedText({ text: 'hi', apiKey: '   ' })).rejects.toMatchObject({ status: 503 })
  })

  it('throws 502 when the provider is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'))
    await expect(embedText({ text: 'hi', apiKey: 'sk-x' })).rejects.toMatchObject({ status: 502 })
  })

  it('throws 502 on a non-2xx provider response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('rate limited', { status: 429 }))
    await expect(embedText({ text: 'hi', apiKey: 'sk-x' })).rejects.toMatchObject({ status: 502 })
  })

  it('throws 502 when the returned vector has the wrong dimension', async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(vector(512)))
    await expect(embedText({ text: 'hi', apiKey: 'sk-x' })).rejects.toMatchObject({ status: 502 })
  })
})

describe('formatVector / parseVector', () => {
  it('round-trips a vector through the pgvector text format', () => {
    expect(formatVector([1, 2, 3])).toBe('[1,2,3]')
    expect(parseVector('[1,2,3]')).toEqual([1, 2, 3])
  })
  it('passes an array through and maps null to null', () => {
    expect(parseVector([0.1, 0.2])).toEqual([0.1, 0.2])
    expect(parseVector(null)).toBeNull()
  })
  it('parses an empty vector literal as an empty array', () => {
    expect(parseVector('[]')).toEqual([])
  })
})
