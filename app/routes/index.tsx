import { createFileRoute } from '@tanstack/react-router'

import { VibeLandingPage } from '@/components/vibe-design/vibe-pages'

export const Route = createFileRoute('/')({
  component: VibeLandingPage,
})
