import { useEffect } from 'react'

export function useBackButtonClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const controller = new AbortController()
    window.history.pushState({ panel: true }, '')
    window.addEventListener('popstate', onClose, { signal: controller.signal })

    return () => controller.abort()
  }, [isOpen, onClose])
}
