import { useEffect } from 'react'

import { startInstallPrompt } from '@/lib/pwa-install-controller'

export function InstallPrompt() {
  useEffect(startInstallPrompt, [])
  return null
}
