import { useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'

import { SettingsContext } from './use-settings'

export function SettingsProvider({ children }: PropsWithChildren) {
  const [compactMode, setCompactMode] = useState(false)
  const value = useMemo(() => ({ compactMode, setCompactMode }), [compactMode])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
