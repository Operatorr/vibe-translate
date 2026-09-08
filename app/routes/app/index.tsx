import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { toast } from 'sonner'

import { AppExperience } from '@/components/app/app-experience'

export const Route = createFileRoute('/app/')({
  component: AppIndex,
})

function AppIndex() {
  // Dodo checkout returns to `/app?upgraded=1`; confirm and clean the URL.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') === '1') {
      toast.success('Subscription active — your new credits are ready.')
      params.delete('upgraded')
      const query = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''))
    }
  }, [])

  return <AppExperience />
}
