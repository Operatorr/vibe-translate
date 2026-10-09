export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type CreditRequirement = {
  balance: number
  requiredCredits: number
}

function creditRequirement(value: unknown): CreditRequirement | null {
  if (typeof value !== 'object' || value === null) return null
  const details = value as Record<string, unknown>
  if (
    details.code !== 'insufficient_credits' ||
    typeof details.balance !== 'number' ||
    !Number.isSafeInteger(details.balance) ||
    typeof details.requiredCredits !== 'number' ||
    !Number.isSafeInteger(details.requiredCredits) ||
    details.requiredCredits <= 0
  )
    return null
  return { balance: details.balance, requiredCredits: details.requiredCredits }
}

// Auth is the Better Auth session cookie (same origin), sent automatically.
type ApiFetchOptions = RequestInit & {
  responseType?: 'json' | 'blob'
}

export async function apiFetch<TData>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<TData> {
  const { headers, responseType = 'json', ...init } = options
  const requestHeaders = new Headers(headers)

  if (!requestHeaders.has('content-type') && init.body) {
    requestHeaders.set('content-type', 'application/json')
  }

  // StrictMode can detach Query's first observer synchronously. Give its
  // cancellation one microtask to settle before starting an HTTP request.
  if (init.signal) {
    await Promise.resolve()
    init.signal.throwIfAborted()
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: requestHeaders,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = (
    contentType.includes('application/json') ? await response.json() : null
  ) as {
    error?: { message?: string; details?: unknown }
  } | null

  if (!response.ok) {
    if (response.status === 402 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('vibe:credits-required', {
          detail: creditRequirement(payload?.error?.details),
        }),
      )
    }
    throw new ApiError(
      payload?.error?.message ?? 'Request failed',
      response.status,
      payload,
    )
  }

  if (responseType === 'blob') {
    return (await response.blob()) as TData
  }

  return payload as TData
}
