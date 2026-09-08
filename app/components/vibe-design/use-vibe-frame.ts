import { useNavigate } from '@tanstack/react-router'
import * as React from 'react'

export type VibeRoute = '/' | '/pricing' | '/app'
export type NavigateFn = (path: VibeRoute) => void

const THEME_KEY = 'vibe-translate:theme'

function readTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // storage unavailable (private mode etc.) — fall through to default
  }
  return 'dark'
}

// Page-level chrome state shared by the landing, pricing and app pages: theme
// (persisted), ⌘K palette toggle, scroll reset on route change.
export function useVibeFrame(route: VibeRoute) {
  const navigate = useNavigate()
  const [theme, setTheme] = React.useState<'dark' | 'light'>(readTheme)
  const [paletteOpen, setPaletteOpen] = React.useState(false)

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [route])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onNavigate = React.useCallback(
    (path: VibeRoute) => {
      void navigate({ to: path as never })
    },
    [navigate],
  )

  const onToggleTheme = React.useCallback(
    () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  )

  return { theme, paletteOpen, setPaletteOpen, onNavigate, onToggleTheme }
}
