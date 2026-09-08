import { useAuth } from '@clerk/react'
import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

// Auth gate for the product shell: unauthenticated visitors go to /auth.
function AppLayout() {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) {
    return (
      <main className="app-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="text-sm text-muted">Loading…</p>
      </main>
    )
  }
  if (!isSignedIn) return <Navigate to={'/auth' as never} />
  return <Outlet />
}
