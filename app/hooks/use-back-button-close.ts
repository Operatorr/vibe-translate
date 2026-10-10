import { useEffect, useRef } from 'react'

// history.state key marking the entry an open overlay pushed.
const OVERLAY_KEY = 'vtOverlay'
let seq = 0

const topMarker = () =>
  (window.history.state as Record<string, unknown> | null)?.[OVERLAY_KEY]

// Lets the browser/hardware Back button close an overlay instead of
// navigating. Opening pushes one entry that copies history.state (TanStack
// Router's keys, the mobile pane stack's vtPane/vtStack) plus a marker, so
// other popstate handlers see an unchanged location when it pops. Back closes
// the overlay; an explicit close or unmount pops the entry itself — only while
// it is still on top — so no phantom entry is left behind.
export function useBackButtonClose(open: boolean, onClose: () => void) {
  // Callers pass a fresh onClose each render; reading it through a ref keeps
  // the effect keyed on `open` alone, so re-renders never re-push.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const marker = `${Date.now().toString(36)}.${++seq}`
    window.history.pushState(
      { ...window.history.state, [OVERLAY_KEY]: marker },
      '',
    )
    let popped = false
    const onPop = () => {
      popped = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop, { once: true })
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!popped && topMarker() === marker) window.history.back()
    }
  }, [open])
}
