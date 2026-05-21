import type { Client } from 'pg'

// Credit accounting for the platform key path. BYOK requests skip this
// module entirely — see docs/adr/0003.

export type CreditCost = {
  // Cost in credits, derived from token usage × the model's credit_cost_multiplier.
  credits: number
  // Underlying token breakdown for the credit_ledger row.
  promptTokens: number
  completionTokens: number
  modelId: string
}

export type LedgerReason =
  | 'grant.signup'
  | 'grant.monthly'
  | 'grant.adjustment'
  | 'spend.translate'
  | 'spend.explain'

export async function getBalance(db: Client, userId: string): Promise<number> {
  const result = await db.query<{ credits_balance: number }>(
    `select credits_balance from users where clerk_user_id = $1`,
    [userId],
  )
  return result.rows[0]?.credits_balance ?? 0
}

// Atomic spend: decrement balance and append a ledger row in one transaction.
// Caller is responsible for verifying the balance pre-check before kicking off
// the model call, but the final write is authoritative.
export async function recordSpend(
  db: Client,
  userId: string,
  cost: CreditCost,
  reason: Extract<LedgerReason, 'spend.translate' | 'spend.explain'>,
  referenceId: string,
): Promise<number> {
  await db.query('begin')
  try {
    await db.query(
      `update users
         set credits_balance = credits_balance - $2,
             updated_at = now()
       where clerk_user_id = $1`,
      [userId, cost.credits],
    )
    await db.query(
      `insert into credit_ledger (user_id, delta, reason, reference_id, metadata)
       values ($1, $2, $3, $4, $5)`,
      [
        userId,
        -cost.credits,
        reason,
        referenceId,
        JSON.stringify({
          modelId: cost.modelId,
          promptTokens: cost.promptTokens,
          completionTokens: cost.completionTokens,
        }),
      ],
    )
    const result = await db.query<{ credits_balance: number }>(
      `select credits_balance from users where clerk_user_id = $1`,
      [userId],
    )
    await db.query('commit')
    return result.rows[0]?.credits_balance ?? 0
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  }
}

export async function recordGrant(
  db: Client,
  userId: string,
  amount: number,
  reason: Extract<LedgerReason, 'grant.signup' | 'grant.monthly' | 'grant.adjustment'>,
  metadata: Record<string, unknown> = {},
): Promise<number> {
  await db.query('begin')
  try {
    await db.query(
      `update users
         set credits_balance = credits_balance + $2,
             credits_refilled_at = case when $3 = 'grant.monthly' then now()
                                        else credits_refilled_at end,
             updated_at = now()
       where clerk_user_id = $1`,
      [userId, amount, reason],
    )
    await db.query(
      `insert into credit_ledger (user_id, delta, reason, metadata)
       values ($1, $2, $3, $4)`,
      [userId, amount, reason, JSON.stringify(metadata)],
    )
    const result = await db.query<{ credits_balance: number }>(
      `select credits_balance from users where clerk_user_id = $1`,
      [userId],
    )
    await db.query('commit')
    return result.rows[0]?.credits_balance ?? 0
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  }
}

export function computeCredits(
  promptTokens: number,
  completionTokens: number,
  modelId: string,
  multiplier: number,
): CreditCost {
  const credits = Math.max(1, Math.ceil((promptTokens + completionTokens) * multiplier))
  return { credits, promptTokens, completionTokens, modelId }
}
