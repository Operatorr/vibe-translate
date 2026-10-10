import { createAuthClient } from 'better-auth/react'

import { clearDrafts } from '@/lib/draft-store'
import { clearPersistedCache } from '@/lib/query-cache-store'

// Better Auth client. Same origin as the worker (/api/auth/*), so the session
// rides on an httpOnly cookie — no tokens in JS. See api/_lib/auth.ts.
export const authClient = createAuthClient()

// Tri-state sign-in: `undefined` until known. A failed session fetch (offline,
// worker down) stays unknown rather than reading as signed out, so the PWA
// doesn't bounce an offline user to /auth. No session is `data: null`, not an
// error.
export function useSignedIn(): boolean | undefined {
  const { data, isPending, error } = authClient.useSession()
  if (data) return true
  return isPending || error ? undefined : false
}

// Ends the session, wipes the offline query cache and unsent drafts, and
// hard-navigates home so no in-memory data from this account survives into the
// next one. A failed sign-out keeps the drafts: the user is still signed in.
export async function signOut(): Promise<void> {
  await clearPersistedCache().catch(() => undefined)
  const { error } = await authClient.signOut()
  if (error) throw new Error(error.message ?? 'Could not sign out.')
  clearDrafts()
  window.location.assign('/')
}

// The reset response has already expired cookies; explicitly clear the client
// store because /reset-password is not a built-in session notification path.
export async function clearResetSession(): Promise<void> {
  await clearPersistedCache().catch(() => undefined)
  clearDrafts()
  const session = authClient.$store.atoms.session
  session.set({ ...session.get(), data: null, error: null, isPending: false })
}
