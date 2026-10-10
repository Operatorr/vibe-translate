// Unsent composer drafts, keyed by context (thread, or `new:<characterId>`)
// and scoped per account. sessionStorage survives in-app route changes and the
// full-page checkout round trip in this tab, but never reaches another tab or
// outlives the browsing session. Storage can be missing or refuse writes
// (private mode, quota), so every access fails soft and the composer keeps its
// drafts in memory.

export type Drafts = Record<string, string>

const PREFIX = 'vibe-translate:drafts:'
const keyFor = (ownerId: string) => `${PREFIX}${ownerId}`

export function readDrafts(ownerId: string): Drafts {
  try {
    const raw = sessionStorage.getItem(keyFor(ownerId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1] !== '',
      ),
    )
  } catch {
    return {}
  }
}

// Empty drafts are dropped; an owner with none left loses the key entirely.
export function writeDrafts(ownerId: string, drafts: Drafts): void {
  const kept = Object.entries(drafts).filter(([, text]) => text !== '')
  try {
    if (kept.length)
      sessionStorage.setItem(
        keyFor(ownerId),
        JSON.stringify(Object.fromEntries(kept)),
      )
    else sessionStorage.removeItem(keyFor(ownerId))
  } catch {
    // Memory-only for this session.
  }
}

// Removes every account's drafts (sign-out, password reset).
export function clearDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // Nothing persisted.
  }
}
