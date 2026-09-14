export type PaletteItem = {
  id: string
  label: string
  icon: string
  hint?: string | null
  // Secondary grouping label shown at the right when there is no hint.
  group?: string
}

// Shortcut modifier label: ⌘ on Apple platforms, Ctrl elsewhere (the handlers
// accept either metaKey or ctrlKey).
export const MOD_KEY =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl'

export const DEFAULT_PALETTE_ITEMS: PaletteItem[] = [
  {
    id: 'new',
    label: 'New translation thread',
    icon: 'plus',
    hint: `${MOD_KEY} N`,
  },
  { id: 'focus', label: 'Focus composer', icon: 'languages', hint: '/' },
  {
    id: 'theme',
    label: 'Toggle theme',
    icon: 'sun-moon',
    hint: `${MOD_KEY} ⇧ L`,
  },
  { id: 'logout', label: 'Sign out', icon: 'log-out', hint: null },
]
