import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import { ErrorBoundary } from '@/components/ui/error-boundary'
import { OfflineBanner } from '@/components/ui/offline-banner'

type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error }) => (
    <main className="mx-auto flex min-h-screen max-w-[42rem] flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-sm text-muted">{error.message}</p>
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-[42rem] flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 text-sm text-muted">The route you requested does not exist.</p>
    </main>
  ),
})

function RootLayout() {
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <Outlet />
    </ErrorBoundary>
  )
}
