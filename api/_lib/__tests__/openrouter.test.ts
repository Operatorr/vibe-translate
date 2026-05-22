import type { Client } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../models', () => ({
  getDefaultModel: vi.fn(),
}))
vi.mock('../secrets', () => ({
  decryptSecret: vi.fn(),
}))

import type { Bindings } from '../env'
import { getDefaultModel } from '../models'
import { resolveCallTarget, stripFences } from '../openrouter'
import { decryptSecret } from '../secrets'

const mockGetDefaultModel = vi.mocked(getDefaultModel)
const mockDecryptSecret = vi.mocked(decryptSecret)

const platformModel = {
  id: 'model-row-1',
  task: 'translate' as const,
  provider: 'openrouter',
  providerModelId: 'deepseek/deepseek-v4-pro',
  displayName: 'DeepSeek',
  isDefault: true,
  embeddingDimensions: null,
  creditCostMultiplier: 1.5,
}

const env = { OPENROUTER_API_KEY: 'sk-platform', CREDENTIALS_ENCRYPTION_KEY: 'enc-key' } as Bindings

function fakeDb(row: Record<string, unknown> | undefined) {
  return { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) } as unknown as Client
}

beforeEach(() => {
  mockGetDefaultModel.mockReset()
  mockDecryptSecret.mockReset()
  mockGetDefaultModel.mockResolvedValue(platformModel)
})

describe('resolveCallTarget', () => {
  it('uses the platform key + default model when the user has no BYOK key', async () => {
    const target = await resolveCallTarget(fakeDb({ openrouter_api_key_cipher: null }), env, 'u1', 'translate')
    expect(target).toEqual({
      apiKey: 'sk-platform',
      modelId: 'deepseek/deepseek-v4-pro',
      modelRowId: 'model-row-1',
      creditCostMultiplier: 1.5,
      isByok: false,
    })
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('always uses the platform path for dictation, skipping the BYOK lookup', async () => {
    const db = fakeDb({ openrouter_api_key_cipher: 'cipher' })
    const target = await resolveCallTarget(db, env, 'u1', 'dictation')
    expect(target.isByok).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('uses the decrypted BYOK key and the per-task model override when present', async () => {
    mockDecryptSecret.mockResolvedValue('sk-user-byok')
    const db = fakeDb({
      openrouter_api_key_cipher: 'cipher',
      byok_translate_model_id: 'anthropic/claude-opus-4.7',
    })
    const target = await resolveCallTarget(db, env, 'u1', 'translate')
    expect(target).toEqual({
      apiKey: 'sk-user-byok',
      modelId: 'anthropic/claude-opus-4.7',
      modelRowId: null,
      creditCostMultiplier: 0,
      isByok: true,
    })
  })

  it('falls back to the platform default model under BYOK when no override is set', async () => {
    mockDecryptSecret.mockResolvedValue('sk-user-byok')
    const db = fakeDb({ openrouter_api_key_cipher: 'cipher', byok_translate_model_id: null })
    const target = await resolveCallTarget(db, env, 'u1', 'translate')
    expect(target.isByok).toBe(true)
    expect(target.modelId).toBe('deepseek/deepseek-v4-pro')
  })

  it('falls back to the platform path (not a 500) when decryption fails', async () => {
    mockDecryptSecret.mockRejectedValue(new Error('bad cipher'))
    const target = await resolveCallTarget(fakeDb({ openrouter_api_key_cipher: 'cipher' }), env, 'u1', 'explain')
    expect(target.isByok).toBe(false)
    expect(target.apiKey).toBe('sk-platform')
  })

  it('throws 503 when the platform key is missing', async () => {
    const noKeyEnv = { CREDENTIALS_ENCRYPTION_KEY: 'enc-key' } as Bindings
    await expect(
      resolveCallTarget(fakeDb({ openrouter_api_key_cipher: null }), noKeyEnv, 'u1', 'translate'),
    ).rejects.toMatchObject({ status: 503 })
  })

  it('applies the env model + reasoning override on the platform path', async () => {
    const env2 = { ...env, TRANSLATE_MODEL: 'x-ai/grok-4.3', TRANSLATE_REASONING: 'low' } as Bindings
    const target = await resolveCallTarget(fakeDb({ openrouter_api_key_cipher: null }), env2, 'u1', 'translate')
    expect(target.modelId).toBe('x-ai/grok-4.3')
    expect(target.reasoning).toBe('low')
    // still the registry row, so the credit multiplier is preserved
    expect(target.modelRowId).toBe('model-row-1')
  })

  it('lets a BYOK model win over the env override, but still applies reasoning', async () => {
    mockDecryptSecret.mockResolvedValue('sk-user-byok')
    const env2 = { ...env, TRANSLATE_MODEL: 'x-ai/grok-4.3', TRANSLATE_REASONING: 'medium' } as Bindings
    const target = await resolveCallTarget(
      fakeDb({ openrouter_api_key_cipher: 'cipher', byok_translate_model_id: 'anthropic/claude-opus-4.7' }),
      env2,
      'u1',
      'translate',
    )
    expect(target.isByok).toBe(true)
    expect(target.modelId).toBe('anthropic/claude-opus-4.7')
    expect(target.reasoning).toBe('medium')
  })

  it('ignores an invalid reasoning effort value', async () => {
    const env2 = { ...env, EXPLAIN_REASONING: 'turbo' } as Bindings
    const target = await resolveCallTarget(fakeDb({ openrouter_api_key_cipher: null }), env2, 'u1', 'explain')
    expect(target.reasoning).toBeUndefined()
  })
})

describe('stripFences', () => {
  it('returns plain JSON unchanged', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}')
  })
  it('unwraps a ```json fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('unwraps a bare ``` fence', () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
})
