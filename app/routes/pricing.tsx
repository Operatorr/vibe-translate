import { createFileRoute } from '@tanstack/react-router'

import { VibePricingPage } from '@/components/vibe-design/vibe-pages'

export const Route = createFileRoute('/pricing')({
  component: VibePricingPage,
})
