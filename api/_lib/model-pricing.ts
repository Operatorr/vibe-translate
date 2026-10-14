import { HTTPException } from 'hono/http-exception'
import * as z from 'zod'

export type ModelPricing = {
  prompt: number
  completion: number
  request: number
}
const price = z
  .string()
  .transform(Number)
  .pipe(z.number().finite().nonnegative())
const modelSchema = z.object({
  id: z.string(),
  pricing: z.object({
    prompt: price,
    completion: price,
    request: price.optional(),
  }),
})
const catalogSchema = z.object({ data: z.array(z.unknown()) })
// Public catalog data only. No keys, user state, or in-flight promises cached.
let catalog: { expires: number; prices: Map<string, ModelPricing> } | undefined

export async function getModelPricing(modelId: string): Promise<ModelPricing> {
  if (!catalog || catalog.expires <= Date.now()) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error('Catalog unavailable')
      const body = catalogSchema.parse(await response.json())
      // Router/auto models publish -1 for unknown prices. Skip those entries;
      // they must not make the entire catalog unusable for priced models.
      const models = body.data.flatMap((row) => {
        const parsed = modelSchema.safeParse(row)
        return parsed.success ? [parsed.data] : []
      })
      catalog = {
        expires: Date.now() + 5 * 60_000,
        prices: new Map(
          models.map(({ id, pricing }) => [
            id,
            {
              prompt: pricing.prompt,
              completion: pricing.completion,
              request: pricing.request ?? 0,
            },
          ]),
        ),
      }
    } catch {
      throw new HTTPException(503, {
        message: 'Model pricing is temporarily unavailable. Please try again.',
      })
    }
  }
  const pricing = catalog.prices.get(modelId)
  if (!pricing)
    throw new HTTPException(503, {
      message: 'Pricing is unavailable for the configured model',
    })
  return pricing
}
