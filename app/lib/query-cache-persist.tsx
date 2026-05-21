import type { QueryClient } from '@tanstack/react-query'
import { get, set } from 'idb-keyval'
import { useEffect } from 'react'

const CACHE_KEY = 'vibe-translate:query-cache'
const PERSISTED_KEYS = new Set(['characters', 'threads', 'segments', 'activity'])

type CacheHydratorProps = {
  queryClient: QueryClient
}

export function CacheHydrator({ queryClient }: CacheHydratorProps) {
  useEffect(() => {
    let cancelled = false

    get<Array<[unknown[], unknown]>>(CACHE_KEY).then((entries) => {
      if (cancelled || !entries) {
        return
      }

      for (const [queryKey, data] of entries) {
        queryClient.setQueryData(queryKey, data)
      }
    })

    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const entries = queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => PERSISTED_KEYS.has(String(query.queryKey[0])))
        .map((query) => [query.queryKey, query.state.data] as [unknown[], unknown])
        .filter(([, data]) => data !== undefined)

      void set(CACHE_KEY, entries)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [queryClient])

  return null
}
