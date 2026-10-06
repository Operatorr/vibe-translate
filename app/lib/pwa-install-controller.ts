import { toast } from 'sonner'

const DISMISS_KEY = 'vibe-translate:install-dismissed-at'
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000
const TOAST_ID = 'pwa-install'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isMobile(): boolean {
  return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && navigator.maxTouchPoints > 1)
  )
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return at > 0 && Date.now() - at < DISMISS_TTL_MS
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // Installation still works when storage is unavailable.
  }
}

// Kept separate from React so browser events and native-prompt outcomes can be
// tested without relying on a browser implementing beforeinstallprompt.
export function startInstallPrompt(): () => void {
  if (isStandalone() || recentlyDismissed() || !window.isSecureContext)
    return () => {}

  let shown = false
  let installed = false
  let disposed = false
  const canShow = () =>
    !disposed &&
    !installed &&
    !shown &&
    !isStandalone() &&
    isMobile() &&
    !recentlyDismissed()
  const options = {
    id: TOAST_ID,
    position: 'bottom-center' as const,
    duration: Infinity,
    onDismiss: markDismissed,
    cancel: { label: 'Not now', onClick: markDismissed },
  }

  const onBeforeInstall = (event: Event) => {
    if (!canShow()) return
    // Desktop Chromium retains its own native install UI.
    event.preventDefault()
    shown = true
    const installEvent = event as BeforeInstallPromptEvent
    toast('Install Vibe Translate?', {
      ...options,
      description:
        'Add Vibe to your home screen. Reopen your saved translations offline.',
      action: {
        label: 'Install',
        onClick: () => {
          // The event can only be used once and prompt() needs a user gesture.
          void (async () => {
            try {
              await installEvent.prompt()
              const { outcome } = await installEvent.userChoice
              if (outcome === 'dismissed') markDismissed()
              if (outcome === 'accepted') onInstalled()
            } catch {
              if (!disposed && !installed) {
                toast.error(
                  'Could not open the install prompt. Try your browser’s Install app or Add to Home Screen menu.',
                )
              }
            }
          })()
        },
      },
    })
  }

  const onInstalled = () => {
    installed = true
    window.clearTimeout(iosTimer)
    toast.dismiss(TOAST_ID)
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', onInstalled)

  // iOS has no native prompt API. Its Share menu installs the app instead.
  const iosTimer = window.setTimeout(() => {
    if (!canShow() || !isIos()) return
    shown = true
    toast('Install Vibe Translate?', {
      ...options,
      description:
        'Tap Share (or open the browser menu), then Add to Home Screen. Keep Open as Web App on if shown, and tap Add.',
      action: { label: 'Got it', onClick: markDismissed },
    })
  }, 2500)

  return () => {
    disposed = true
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    window.removeEventListener('appinstalled', onInstalled)
    window.clearTimeout(iosTimer)
    toast.dismiss(TOAST_ID)
  }
}
