import { useAuth } from '@clerk/react'
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { AppHeader } from '@/components/app/app-header'
import { AppSidebar } from '@/components/app/app-sidebar'
import { SettingsProvider } from '@/lib/settings-context'

export const Route = createFileRoute('/app')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/app/auth-required') {
      throw redirect({ to: '/auth' as never })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { isSignedIn, isLoaded } = useAuth()

  if (!isLoaded) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-6">
        <p className="text-sm text-muted">Loading workspace...</p>
      </main>
    )
  }

  if (!isSignedIn) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="rounded-lg border border-border bg-panel p-6">
          <h1 className="text-xl font-semibold">Sign in required</h1>
          <Link className="button-primary mt-5 inline-flex" to={'/auth' as never}>
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <SettingsProvider>
      <div className="grid min-h-screen grid-cols-[17rem_1fr] bg-surface text-foreground">
        <AppSidebar />
        <div className="min-w-0">
          <AppHeader />
          <Outlet />
        </div>
      </div>
    </SettingsProvider>
  )
}
