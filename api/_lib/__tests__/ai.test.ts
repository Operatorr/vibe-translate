import { beforeEach, describe, expect, it, vi } from 'vitest'

// The OpenRouter call is exercised separately (openrouter.test.ts); here we mock
// chatJson to test the translate/dictation wiring + post-processing in isolation.
vi.mock('../openrouter', () => ({ chatJson: vi.fn() }))

import { draftCharacterFromDictation, finalizeTokens, translateSegment } from '../ai'
import type { TranslateSegmentInput } from '../ai'
import { chatJson, type ProviderConfig } from '../openrouter'

const mockChatJson = vi.mocked(chatJson)

const input = (overrides: Partial<TranslateSegmentInput> = {}): TranslateSegmentInput => ({
  sourceText: 'good morning',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  vibe: 'casual',
  temperature: 0.4,
  persona: { traits: [] },
  ...overrides,
})

const config: ProviderConfig = { apiKey: 'sk-test', modelId: 'deepseek/deepseek-v4-pro' }

beforeEach(() => mockChatJson.mockReset())

describe('finalizeTokens', () => {
  it('keeps alignment that reconstructs the target text', () => {
    const out = finalizeTokens(
      {
        targetText: 'おはよう、ケンジ',
        tokens: [
          { t: 'おはよう', src: 'good morning' },
          { t: '、', src: '' },
          { t: 'ケンジ', src: 'Kenji' },
        ],
      },
      input(),
    )
    expect(out.targetText).toBe('おはよう、ケンジ')
    expect(out.tokens).toHaveLength(3)
  })

  it('degrades to a single token when tokens do not reconstruct the target', () => {
    const out = finalizeTokens(
      { targetText: 'おはようございます', tokens: [{ t: 'おはよう', src: 'good morning' }] },
      input({ sourceText: 'good morning' }),
    )
    expect(out.tokens).toEqual([{ t: 'おはようございます', src: 'good morning' }])
  })

  it('degrades when the tokens array is empty', () => {
    const out = finalizeTokens({ targetText: 'やあ', tokens: [] }, input())
    expect(out.tokens).toEqual([{ t: 'やあ', src: 'good morning' }])
  })

  it('throws on whitespace-only target text', () => {
    expect(() => finalizeTokens({ targetText: '   ', tokens: [] }, input())).toThrow()
  })
})

describe('translateSegment', () => {
  it('returns translation, alignment, and usage on the happy path', async () => {
    mockChatJson.mockResolvedValue({
      data: { targetText: 'おはよう', tokens: [{ t: 'おはよう', src: 'good morning' }] },
      tokenUsage: { modelId: 'deepseek/deepseek-v4-pro', promptTokens: 10, completionTokens: 5, costCents: 5 },
    })
    const result = await translateSegment(input(), config)
    expect(result.targetText).toBe('おはよう')
    expect(result.tokenAlignment).toEqual([{ t: 'おはよう', src: 'good morning' }])
    expect(result.tokenUsage).toEqual({
      modelId: 'deepseek/deepseek-v4-pro',
      promptTokens: 10,
      completionTokens: 5,
      costCents: 5,
    })
  })

  it('degrades alignment when the model output does not reconstruct', async () => {
    mockChatJson.mockResolvedValue({
      data: { targetText: 'おはようございます', tokens: [{ t: 'おはよう', src: 'good morning' }] },
      tokenUsage: { modelId: 'm', promptTokens: 1, completionTokens: 1 },
    })
    const result = await translateSegment(input({ sourceText: 'good morning' }), config)
    expect(result.tokenAlignment).toEqual([{ t: 'おはようございます', src: 'good morning' }])
  })

  it('surfaces a malformed provider result as an error (no swallowing)', async () => {
    // chatJson's own error mapping is covered in openrouter.test.ts; here we
    // only assert translateSegment does not hide a bad result.
    mockChatJson.mockResolvedValue(null as never)
    await expect(translateSegment(input(), config)).rejects.toThrow()
  })
})

describe('draftCharacterFromDictation', () => {
  it('maps the model output onto a CharacterDraft, dropping invalid locales', async () => {
    mockChatJson.mockResolvedValue({
      data: {
        ok: true,
        name: 'Tomoko',
        sourceLanguage: 'en-US',
        targetLanguage: 'not a locale',
        defaultVibe: 'friend',
        temperature: 0.6,
        persona: { age: '20s', region: 'Tokyo', formality: null, traits: ['warm'] },
        instructions: 'friend in Tokyo',
      },
      tokenUsage: { modelId: 'g', promptTokens: 8, completionTokens: 4 },
    })
    const { draft, tokenUsage } = await draftCharacterFromDictation('text my friend Tomoko', config)
    expect(draft).toMatchObject({
      ok: true,
      name: 'Tomoko',
      sourceLanguage: 'en-US',
      defaultVibe: 'friend',
      temperature: 0.6,
      instructions: 'friend in Tokyo',
    })
    expect(draft.targetLanguage).toBeUndefined() // invalid BCP-47 dropped
    expect(draft.persona).toEqual({ age: '20s', region: 'Tokyo', traits: ['warm'] })
    expect(tokenUsage?.promptTokens).toBe(8)
  })

  it('clamps an out-of-range temperature', async () => {
    mockChatJson.mockResolvedValue({
      data: {
        ok: true,
        name: null,
        sourceLanguage: null,
        targetLanguage: null,
        defaultVibe: null,
        temperature: 5,
        persona: null,
        instructions: null,
      },
      tokenUsage: { modelId: 'g', promptTokens: 1, completionTokens: 1 },
    })
    const { draft } = await draftCharacterFromDictation('x', config)
    expect(draft.temperature).toBe(1)
  })

  it('returns ok:false when the model reports an unusable prompt', async () => {
    mockChatJson.mockResolvedValue({
      data: {
        ok: false,
        name: null,
        sourceLanguage: null,
        targetLanguage: null,
        defaultVibe: null,
        temperature: null,
        persona: null,
        instructions: null,
      },
      tokenUsage: { modelId: 'g', promptTokens: 1, completionTokens: 1 },
    })
    const { draft } = await draftCharacterFromDictation('???', config)
    expect(draft).toEqual({ ok: false })
  })

  it('falls back to the empty form when the provider result is unusable', async () => {
    // Any failure in the chatJson path (a throw, or a malformed result like this)
    // degrades to { ok: false } rather than surfacing a 5xx to the client.
    mockChatJson.mockResolvedValue(null as never)
    const { draft, tokenUsage } = await draftCharacterFromDictation('x', config)
    expect(draft).toEqual({ ok: false })
    expect(tokenUsage).toBeUndefined()
  })
})
