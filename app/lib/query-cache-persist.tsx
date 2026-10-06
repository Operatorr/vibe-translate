import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { authClient } from '@/lib/auth-client'
import { CacheReadyContext } from '@/lib/query-cache-context'
import { queryCachePersistence } from '@/lib/query-cache-store'

export function CacheHydrator({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession()
  const owner = data?.user.id ?? (error ? undefined : null)
  const identity = isPending
    ? 'pending'
    : (owner ?? (error ? 'offline' : 'signed-out'))
  const [readyFor, setReadyFor] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    let cancelled = false
    // The product gate waits until ownership has switched and hydration is
    // complete. Public auth forms stay mounted across session changes.
    void queryCachePersistence
      .activate(owner)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setReadyFor(identity)
      })
    return () => {
      cancelled = true
      queryCachePersistence.stop()
    }
  }, [identity, isPending, owner])

  return (
    <CacheReadyContext.Provider value={readyFor === identity}>
      {children}
    </CacheReadyContext.Provider>
  )
}
