import type { Client } from 'pg'

import { recordGrant } from './credits'
import { tierLimits, type Tier } from './tier'

// User provisioning. Clerk owns identity; the first authenticated request for a
// given clerk_user_id lazily creates the local row and grants the free-tier
// signup credits. Routes call getOrCreateUser after connecting. (auth.ts only
// sets context vars — it does not touch the DB.) See docs/BACKEND.md.

export type UserRow = {
  clerkUserId: string
  email: string | null
  displayName: string | null
  tier: Tier
  onboardingComplete: boolean
  creditsBalance: number
  creditsRefilledAt: string | null
  byokConfigured: boolean
  byokLast4: string | null
  byokTranslateModelId: string | null
  byokExplainModelId: string | null
  locale: string | null
}

type UserDbRow = {
  clerk_user_id: string
  email: string | null
  display_name: string | null
  tier: Tier
  onboarding_complete: boolean
  credits_balance: number
  credits_refilled_at: Date | string | null
  byok_configured: boolean
  openrouter_api_key_last4: string | null
  byok_translate_model_id: string | null
  byok_explain_model_id: string | null
  locale: string | null
}

// Never selects the cipher — only the safe `last4` for display.
const USER_COLUMNS = `clerk_user_id, email, display_name, tier, onboarding_complete,
  credits_balance, credits_refilled_at,
  (openrouter_api_key_cipher is not null) as byok_configured,
  openrouter_api_key_last4, byok_translate_model_id, byok_explain_model_id, locale`

function mapUser(row: UserDbRow): UserRow {
  return {
    clerkUserId: row.clerk_user_id,
    email: row.email,
    displayName: row.display_name,
    tier: row.tier,
    onboardingComplete: row.onboarding_complete,
    creditsBalance: row.credits_balance,
    creditsRefilledAt: row.credits_refilled_at
      ? new Date(row.credits_refilled_at).toISOString()
      : null,
    byokConfigured: row.byok_configured,
    byokLast4: row.openrouter_api_key_last4,
    byokTranslateModelId: row.byok_translate_model_id,
    byokExplainModelId: row.byok_explain_model_id,
    locale: row.locale,
  }
}

// Idempotent upsert. `(xmax = 0)` is true only for the freshly-inserted row, so
// the signup grant runs exactly once and the balance == sum(ledger.delta)
// invariant holds from creation.
export async function getOrCreateUser(
  db: Client,
  clerkUserId: string,
  email: string | null,
): Promise<UserRow> {
  const result = await db.query<UserDbRow & { was_inserted: boolean }>(
    `insert into users (clerk_user_id, email)
     values ($1, $2)
     on conflict (clerk_user_id) do update set
       email = coalesce(excluded.email, users.email),
       updated_at = now()
     returning ${USER_COLUMNS}, (xmax = 0) as was_inserted`,
    [clerkUserId, email],
  )
  const row = result.rows[0]

  if (row.was_inserted) {
    await recordGrant(db, clerkUserId, tierLimits.free.credits, 'grant.signup')
    row.credits_balance = tierLimits.free.credits
  }

  return mapUser(row)
}

// Shape the public /api/users/me payload from a UserRow.
export function toMeResponse(user: UserRow) {
  return {
    id: user.clerkUserId,
    email: user.email,
    displayName: user.displayName,
    tier: user.tier,
    limits: tierLimits[user.tier],
    credits: { balance: user.creditsBalance, refilledAt: user.creditsRefilledAt },
    byok: {
      configured: user.byokConfigured,
      last4: user.byokLast4,
      translateModelId: user.byokTranslateModelId,
      explainModelId: user.byokExplainModelId,
    },
    onboardingComplete: user.onboardingComplete,
  }
}
