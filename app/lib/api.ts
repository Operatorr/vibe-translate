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

type ApiFetchOptions = RequestInit & {
  getToken?: () => Promise<string | null>
  responseType?: 'json' | 'blob'
}

export async function apiFetch<TData>(path: string, options: ApiFetchOptions = {}): Promise<TData> {
  const { getToken, headers, responseType = 'json', ...init } = options
  const token = await getToken?.()
  const requestHeaders = new Headers(headers)

  if (!requestHeaders.has('content-type') && init.body) {
    requestHeaders.set('content-type', 'application/json')
  }

  if (token) {
    requestHeaders.set('authorization', `Bearer ${token}`)
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: requestHeaders,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = (contentType.includes('application/json') ? await response.json() : null) as {
    error?: { message?: string }
  } | null

  if (!response.ok) {
    throw new ApiError(payload?.error?.message ?? 'Request failed', response.status, payload)
  }

  if (responseType === 'blob') {
    return (await response.blob()) as TData
  }

  return payload as TData
}
