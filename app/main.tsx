import { ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import { InstallPrompt } from '@/lib/pwa-install'
import { CacheHydrator } from '@/lib/query-cache-persist'
import { registerServiceWorker } from '@/lib/register-service-worker'
import { routeTree } from '@/routeTree.gen'
import '@/styles/app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')
}

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <QueryClientProvider client={queryClient}>
        <CacheHydrator queryClient={queryClient} />
        <RouterProvider router={router} />
        <InstallPrompt />
        <Toaster richColors closeButton position="top-right" />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
)
