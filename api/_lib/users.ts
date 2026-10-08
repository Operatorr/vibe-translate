import type { Client } from 'pg'

import { tierLimits, type Tier } from './tier'

// User provisioning. Better Auth owns identity (auth_users); the first
// app-data or checkout request for a given auth_user_id creates this app-side
// row and grants the free-tier signup credits atomically. Routes call getOrCreateUser
// after connecting. (The auth() middleware only resolves the session and sets
// context vars — it never touches this table.) See docs/BACKEND.md.

export type UserRow = {
  userId: string
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
  auth_user_id: string
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
const USER_COLUMNS = `auth_user_id, email, display_name, tier, onboarding_complete,
  credits_balance, credits_refilled_at,
  (openrouter_api_key_cipher is not null) as byok_configured,
  openrouter_api_key_last4, byok_translate_model_id, byok_explain_model_id, locale`

function mapUser(row: UserDbRow): UserRow {
  return {
    userId: row.auth_user_id,
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

// Read-only for existing users. Provision the balance and ledger in one SQL
// statement so concurrent first requests cannot observe a half-granted account.
export async function getOrCreateUser(
  db: Client,
  userId: string,
  email: string | null,
): Promise<UserRow> {
  const existing = await db.query<UserDbRow>(
    `select ${USER_COLUMNS} from users where auth_user_id = $1`,
    [userId],
  )
  const row = existing.rows[0]
  if (row) {
    if (email !== null && email !== row.email) {
      const updated = await db.query<UserDbRow>(
        `update users set email = $2, updated_at = now()
         where auth_user_id = $1 returning ${USER_COLUMNS}`,
        [userId, email],
      )
      return mapUser(updated.rows[0])
    }
    return mapUser(row)
  }
  const created = await db.query<UserDbRow>(
    `with inserted as (
       insert into users (auth_user_id, email, credits_balance)
       values ($1, $2, $3)
       on conflict (auth_user_id) do nothing
       returning ${USER_COLUMNS}
     ), granted as (
       insert into credit_ledger (user_id, delta, reason)
       select auth_user_id, $3, 'grant.signup' from inserted
     ) select * from inserted`,
    [userId, email, tierLimits.free.credits],
  )
  if (created.rows[0]) return mapUser(created.rows[0])
  // A concurrent insert won. A fresh statement can see its committed row.
  const winner = await db.query<UserDbRow>(
    `select ${USER_COLUMNS} from users where auth_user_id = $1`,
    [userId],
  )
  if (!winner.rows[0]) throw new Error('User disappeared during provisioning')
  return mapUser(winner.rows[0])
}

// Shape the public /api/users/me payload from a UserRow.
export function toMeResponse(user: UserRow) {
  return {
    id: user.userId,
    email: user.email,
    displayName: user.displayName,
    tier: user.tier,
    limits: tierLimits[user.tier],
    credits: {
      balance: user.creditsBalance,
      refilledAt: user.creditsRefilledAt,
    },
    byok: {
      configured: user.byokConfigured,
      last4: user.byokLast4,
      translateModelId: user.byokTranslateModelId,
      explainModelId: user.byokExplainModelId,
    },
    onboardingComplete: user.onboardingComplete,
  }
}
