import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())
it('ignores unknown router prices, caches real prices and resolves the actual model override', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      data: [
        { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
        {
          id: 'openai/gpt-6-luna',
          pricing: { prompt: '0.0000001', completion: '0.0000005' },
        },
      ],
    }),
  )
  const { getModelPricing } = await import('../model-pricing')
  expect(await getModelPricing('openai/gpt-6-luna')).toEqual({
    prompt: 1e-7,
    completion: 5e-7,
    request: 0,
  })
  await getModelPricing('openai/gpt-6-luna')
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect(getModelPricing('openrouter/auto')).rejects.toMatchObject({
    status: 503,
  })
})
it('fails before spending when the price catalog is unavailable', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  const { getModelPricing } = await import('../model-pricing')
  await expect(getModelPricing('openai/gpt-6-luna')).rejects.toMatchObject({
    status: 503,
  })
})
