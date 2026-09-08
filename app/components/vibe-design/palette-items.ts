export type PaletteItem = {
  id: string
  label: string
  icon: string
  hint?: string | null
  // Secondary grouping label shown at the right when there is no hint.
  group?: string
}

export const DEFAULT_PALETTE_ITEMS: PaletteItem[] = [
  { id: 'new', label: 'New translation thread', icon: 'plus', hint: '⌘ N' },
  { id: 'focus', label: 'Focus composer', icon: 'languages', hint: '/' },
  { id: 'theme', label: 'Toggle theme', icon: 'sun-moon', hint: '⌘ ⇧ L' },
  { id: 'logout', label: 'Sign out', icon: 'log-out', hint: null },
]
