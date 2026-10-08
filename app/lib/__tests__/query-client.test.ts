import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import { queryClient, retryTransient } from '../query-client'

const clients: QueryClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

// calls counts the query function, including the one allowed retry.
const cases = [
  { failure: 'ApiError 400', error: new ApiError('rejected', 400), calls: 1 },
  { failure: 'ApiError 401', error: new ApiError('rejected', 401), calls: 1 },
  { failure: 'ApiError 404', error: new ApiError('rejected', 404), calls: 1 },
  { failure: 'ApiError 500', error: new ApiError('down', 500), calls: 2 },
  { failure: 'a fetch TypeError', error: new TypeError('fetch'), calls: 2 },
]

describe('query retry policy', () => {
  it.each(cases)(
    'the predicate allows $calls call(s) for $failure',
    ({ error, calls }) => {
      expect(retryTransient(0, error)).toBe(calls === 2)
      expect(retryTransient(1, error)).toBe(false)
    },
  )

  it.each(cases)(
    'the shared client calls the query function $calls time(s) for $failure',
    async ({ error, calls }) => {
      const defaults = queryClient.getDefaultOptions().queries
      expect(defaults?.retry).toBe(retryTransient)
      const client = new QueryClient({
        defaultOptions: { queries: { ...defaults, retryDelay: 0 } },
      })
      clients.push(client)
      const queryFn = vi.fn(async () => {
        throw error
      })
      await expect(
        client.fetchQuery({ queryKey: ['threads', 'c'], queryFn }),
      ).rejects.toBe(error)
      expect(queryFn).toHaveBeenCalledTimes(calls)
    },
  )
})
