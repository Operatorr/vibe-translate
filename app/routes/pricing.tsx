import { createFileRoute } from '@tanstack/react-router'

import { VibePricingPage } from '@/components/vibe-design/pricing-page'

export const Route = createFileRoute('/pricing')({
  component: VibePricingPage,
})
