import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

// Permanent 4xx responses surface immediately; a 5xx or transport failure gets
// one retry.
export const retryTransient = (failures: number, error: Error) =>
  failures < 1 && !(error instanceof ApiError && error.status < 500)

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: retryTransient,
      refetchOnWindowFocus: false,
    },
  },
})
