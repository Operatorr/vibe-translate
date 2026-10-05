import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { useSignedIn } from '@/lib/auth-client'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

// Auth gate for the product shell: unauthenticated visitors go to /auth.
// `replace` so Back from /auth doesn't land on /app and bounce straight back.
function AppLayout() {
  const isSignedIn = useSignedIn()
  if (isSignedIn === undefined) {
    return (
      <main
        className="app-shell"
        style={{ display: 'grid', placeItems: 'center' }}
      >
        <p className="text-sm text-muted">Loading…</p>
      </main>
    )
  }
  if (!isSignedIn) return <Navigate to="/auth" replace />
  return <Outlet />
}
