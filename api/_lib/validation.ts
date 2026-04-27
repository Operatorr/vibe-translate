import { HTTPException } from 'hono/http-exception'
import type { ZodSchema } from 'zod'

export function parseJson<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new HTTPException(422, {
      message: result.error.issues[0]?.message ?? 'Validation failed',
    })
  }

  return result.data
}
