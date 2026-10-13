import { useEffect, useRef } from 'react'

// history.state key listing the open overlays' markers, outermost first.
const OVERLAY_KEY = 'vtOverlays'
let seq = 0

const openMarkers = (): unknown[] => {
  const markers = (window.history.state as Record<string, unknown> | null)?.[
    OVERLAY_KEY
  ]
  return Array.isArray(markers) ? markers : []
}

// Lets the browser/hardware Back button close an overlay instead of
// navigating. Opening pushes one entry that copies history.state (TanStack
// Router's keys, the mobile pane stack's vtPane/vtStack) and appends a marker
// to the open-overlay list, so other popstate handlers see an unchanged
// location when it pops. A popstate closes the overlay only once its marker
// is gone from the list, so with nested overlays (help over Retry) Back closes
// the topmost first. An explicit close or unmount pops the entry itself — only
// while it is still on top — so no phantom entry is left behind.
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
      { ...window.history.state, [OVERLAY_KEY]: [...openMarkers(), marker] },
      '',
    )
    let popped = false
    const onPop = () => {
      // An overlay above this one popped its entry; stay open.
      if (openMarkers().includes(marker)) return
      popped = true
      window.removeEventListener('popstate', onPop)
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!popped && openMarkers().at(-1) === marker) window.history.back()
    }
  }, [open])
}
