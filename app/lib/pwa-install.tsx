import * as React from 'react'
import { toast } from 'sonner'

// PWA install nudge. Two paths:
//   - Chromium (Android/desktop): capture `beforeinstallprompt`, offer an
//     "Install" action that triggers the native prompt.
//   - iOS Safari: no prompt API, so on a mobile viewport that isn't already
//     standalone we show the "Share → Add to Home Screen" hint instead.
// Dismissal is remembered for 14 days so the toast doesn't nag.

const DISMISS_KEY = 'vibe-translate:install-dismissed-at'
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isMobile(): boolean {
  return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return Date.now() - at < DISMISS_TTL_MS
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

export function InstallPrompt() {
  React.useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return

    let shown = false
    const showChromium = (event: BeforeInstallPromptEvent) => {
      if (shown || !isMobile()) return
      shown = true
      toast('Install Vibe Translate', {
        id: 'pwa-install',
        description: 'Add it to your home screen for a full-screen, offline-ready app.',
        duration: 12_000,
        action: {
          label: 'Install',
          onClick: () => {
            void event.prompt().then(() => event.userChoice).then(({ outcome }) => {
              if (outcome === 'dismissed') markDismissed()
            })
          },
        },
        onDismiss: markDismissed,
      })
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      showChromium(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // iOS never fires beforeinstallprompt; give the manual hint after a beat.
    const iosTimer = window.setTimeout(() => {
      if (shown || !isIos() || !isMobile()) return
      shown = true
      toast('Install Vibe Translate', {
        id: 'pwa-install',
        description: 'Tap Share, then "Add to Home Screen" to install the app.',
        duration: 12_000,
        onDismiss: markDismissed,
        action: { label: 'Got it', onClick: markDismissed },
      })
    }, 2500)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.clearTimeout(iosTimer)
    }
  }, [])

  return null
}
