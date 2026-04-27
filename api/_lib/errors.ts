import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

export type FormattedApiError = {
  message: string
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503
  details?: unknown
}

export function formatError(error: unknown): FormattedApiError {
  if (error instanceof HTTPException) {
    return {
      message: error.message,
      status: error.status as FormattedApiError['status'],
    }
  }

  if (error instanceof ZodError) {
    return {
      message: 'Validation failed',
      status: 422,
      details: error.flatten(),
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      status: 500,
    }
  }

  return {
    message: 'Unknown error',
    status: 500,
  }
}
