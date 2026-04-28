import { createFileRoute } from '@tanstack/react-router'

import { VibeAppPage } from '@/components/vibe-design/vibe-pages'

export const Route = createFileRoute('/app/')({
  component: VibeAppPage,
})
