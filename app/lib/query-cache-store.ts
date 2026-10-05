import { del } from 'idb-keyval'

// IndexedDB key for the persisted query cache (see query-cache-persist.tsx).
export const CACHE_KEY = 'vibe-translate:query-cache'

// The persisted cache isn't per-user: drop it on sign-out so the next account
// on this device never hydrates the previous one's characters and threads.
export function clearPersistedCache(): Promise<void> {
  return del(CACHE_KEY)
}
