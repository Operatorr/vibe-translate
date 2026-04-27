import { useAuth } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'

export function useApiQuery<TData = unknown>(queryKey: QueryKey, path: string) {
  const { getToken, isSignedIn } = useAuth()

  return useQuery({
    queryKey,
    queryFn: async () => apiFetch<TData>(path, { getToken }),
    enabled: path.startsWith('/api/dev') || isSignedIn !== false,
  })
}
