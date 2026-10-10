import { createFileRoute } from '@tanstack/react-router'

import { CreditsPage } from '@/components/app/credits-page'

export const Route = createFileRoute('/app/credits')({
  validateSearch: (search: Record<string, unknown>): { orderId?: string } => ({
    orderId:
      typeof search.orderId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        search.orderId,
      )
        ? search.orderId
        : undefined,
  }),
  component: CreditsRoute,
})

function CreditsRoute() {
  const { orderId } = Route.useSearch()
  return <CreditsPage orderId={orderId} />
}
