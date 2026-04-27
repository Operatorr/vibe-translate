import { useEffect } from 'react'

type ShortcutHandler = (event: KeyboardEvent) => void

export function useKeyboardShortcut(key: string, handler: ShortcutHandler) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === key.toLowerCase()) {
        handler(event)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handler, key])
}
