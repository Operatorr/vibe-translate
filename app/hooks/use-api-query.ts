import { useQuery } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'
import { useSignedIn } from '@/lib/auth-client'

export function useApiQuery<TData = unknown>(queryKey: QueryKey, path: string) {
  const isSignedIn = useSignedIn()

  return useQuery({
    queryKey,
    queryFn: async () => apiFetch<TData>(path),
    enabled: path.startsWith('/api/dev') || isSignedIn !== false,
  })
}
