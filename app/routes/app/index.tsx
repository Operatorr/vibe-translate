import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { AppExperience } from '@/components/app/app-experience'
import { keys } from '@/lib/query-keys'

export const Route = createFileRoute('/app/')({
  component: AppIndex,
})

function AppIndex() {
  const qc = useQueryClient()
  // Dodo checkout returns to `/app?upgraded=1`; confirm and clean the URL.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') === '1') {
      toast.message(
        'Checking your subscription. Your plan and credits update after payment is confirmed.',
      )
      void qc.invalidateQueries({ queryKey: keys.me })
      params.delete('upgraded')
      const query = params.toString()
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (query ? `?${query}` : ''),
      )
    }
  }, [qc])

  return <AppExperience />
}
