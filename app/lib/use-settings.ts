import { createContext, useContext } from 'react'

export type SettingsContextValue = {
  compactMode: boolean
  setCompactMode: (value: boolean) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings() {
  const value = useContext(SettingsContext)

  if (!value) {
    throw new Error('useSettings must be used within SettingsProvider')
  }

  return value
}
