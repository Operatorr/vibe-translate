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
  | 'grant.subscription'
  | 'grant.adjustment'
  | 'spend.translate'
  | 'spend.explain'
  | 'spend.dictation'

export async function getBalance(db: Client, userId: string): Promise<number> {
  const result = await db.query<{ credits_balance: number }>(
    `select credits_balance from users where clerk_user_id = $1`,
    [userId],
  )
  return result.rows[0]?.credits_balance ?? 0
}

export type SpendReason = Extract<
  LedgerReason,
  'spend.translate' | 'spend.explain' | 'spend.dictation'
>

// A reservation handle returned by `reserveCredits`, settled later by
// `reconcileSpend` (charge the real cost) or `refundReservation` (call failed).
export type Reservation = { ledgerId: string; reserved: number }

// Atomically place a pre-call hold of `estimate` credits. Returns null when the
// balance can't cover the hold. This is the concurrency gate: the conditional
// `credits_balance >= $2` UPDATE takes a row lock, so simultaneous requests
// serialize and a user can never start more concurrent calls than they can
// afford — a plain "balance > 0" SELECT lets many in-flight requests bypass the
// check at once. The hold is written to the ledger immediately (as a pending
// `-estimate` row), keeping sum(credit_ledger.delta) == users.credits_balance
// true at all times; reconcile/refund rewrites or removes that row.
export async function reserveCredits(
  db: Client,
  userId: string,
  estimate: number,
  reason: SpendReason,
): Promise<Reservation | null> {
  await db.query('begin')
  try {
    const updated = await db.query(
      `update users
         set credits_balance = credits_balance - $2,
             updated_at = now()
       where clerk_user_id = $1 and credits_balance >= $2`,
      [userId, estimate],
    )
    if (updated.rowCount === 0) {
      await db.query('rollback')
      return null
    }
    const ledger = await db.query<{ id: string }>(
      `insert into credit_ledger (user_id, delta, reason, metadata)
       values ($1, $2, $3, $4) returning id`,
      [userId, -estimate, reason, JSON.stringify({ reservation: true, estimate })],
    )
    await db.query('commit')
    return { ledgerId: ledger.rows[0].id, reserved: estimate }
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  }
}

// Settle a reservation to the real cost: adjust the balance by (reserved - cost)
// and rewrite the pending ledger row to the actual debit. One UPDATE per side,
// in one transaction, so the balance==ledger invariant is preserved.
export async function reconcileSpend(
  db: Client,
  userId: string,
  reservation: Reservation,
  cost: CreditCost,
  referenceId: string | null,
): Promise<number> {
  await db.query('begin')
  try {
    await db.query(
      `update users
         set credits_balance = credits_balance + ($2 - $3),
             updated_at = now()
       where clerk_user_id = $1`,
      [userId, reservation.reserved, cost.credits],
    )
    await db.query(
      `update credit_ledger
          set delta = $2, reference_id = $3, metadata = $4
        where id = $1`,
      [
        reservation.ledgerId,
        -cost.credits,
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

// Release a reservation when the model call failed (or produced nothing
// billable): give the held credits back and drop the pending ledger row.
export async function refundReservation(
  db: Client,
  userId: string,
  reservation: Reservation,
): Promise<void> {
  await db.query('begin')
  try {
    await db.query(
      `update users
         set credits_balance = credits_balance + $2,
             updated_at = now()
       where clerk_user_id = $1`,
      [userId, reservation.reserved],
    )
    await db.query(`delete from credit_ledger where id = $1`, [reservation.ledgerId])
    await db.query('commit')
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

// Pre-call estimate for a credit hold, shaped like computeCredits so it scales
// with the same per-model multiplier. Deliberately generous (system prompt +
// input + a comparable output) so the reservation is a meaningful fraction of
// the real cost — the hold is reconciled to the true token usage afterwards, so
// over-estimating only tightens the concurrency gate, it does not over-charge.
const PROMPT_OVERHEAD_TOKENS = 400

export function estimateCredits(text: string, multiplier: number): number {
  const inputTokens = Math.ceil(text.length / 4)
  const estimatedTokens = PROMPT_OVERHEAD_TOKENS + inputTokens * 2
  return Math.max(1, Math.ceil(estimatedTokens * multiplier))
}
