import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import { InstallPrompt } from '@/lib/pwa-install'
import { queryClient } from '@/lib/query-client'
import { CacheHydrator } from '@/lib/query-cache-persist'
import { registerServiceWorker } from '@/lib/register-service-worker'
import { routeTree } from '@/routeTree.gen'
import '@/styles/app.css'

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

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CacheHydrator>
        <RouterProvider router={router} />
      </CacheHydrator>
      <InstallPrompt />
      <Toaster
        richColors
        closeButton
        position="top-right"
        mobileOffset={{
          top: 'calc(16px + env(safe-area-inset-top))',
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          left: 'calc(16px + env(safe-area-inset-left))',
          right: 'calc(16px + env(safe-area-inset-right))',
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
)
