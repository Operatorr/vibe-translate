import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { authClient } from '@/lib/auth-client'
import { useCacheReady } from '@/lib/query-cache-context'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

// Auth gate for the product shell: unauthenticated visitors go to /auth.
// `replace` so Back from /auth doesn't land on /app and bounce straight back.
function AppLayout() {
  const { data, isPending, error } = authClient.useSession()
  const cacheReady = useCacheReady()
  if (isPending || !cacheReady) {
    return (
      <main
        className="app-shell"
        style={{ display: 'grid', placeItems: 'center' }}
      >
        <p className="text-sm text-muted">Loading…</p>
      </main>
    )
  }
  if (!data && !error) return <Navigate to="/auth" replace />
  return <Outlet />
}
