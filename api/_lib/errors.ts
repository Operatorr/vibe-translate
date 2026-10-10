import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

export type FormattedApiError = {
  message: string
  status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504
  details?: unknown
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly balance: number,
    readonly requiredCredits: number,
  ) {
    super('Not enough credits to start this request')
    this.name = 'InsufficientCreditsError'
  }
}

export function formatError(error: unknown): FormattedApiError {
  if (error instanceof InsufficientCreditsError) {
    return {
      message: error.message,
      status: 402,
      details: {
        code: 'insufficient_credits',
        balance: error.balance,
        requiredCredits: error.requiredCredits,
      },
    }
  }
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
