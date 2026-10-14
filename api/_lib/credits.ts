import type { Client } from 'pg'
import { CREDITS_PER_USD, DEFAULT_CREDIT_MARKUP_PERCENT } from './credit-units'
import { ceilScaledWithPercent } from './decimal'
import type { Bindings } from './env'
import type { TokenUsage } from './openrouter'

// Credit accounting for the platform key path. BYOK requests skip this
// module entirely — see docs/adr/0003.

export type CreditCost = {
  // Whole Credits: provider USD cost plus markup, rounded up per request.
  credits: number
  costUsd?: number
  markupPercent?: number
  // Underlying token breakdown for the credit_ledger row; null when unreported.
  promptTokens: number | null
  completionTokens: number | null
  modelId: string
}

export type LedgerReason =
  | 'grant.signup'
  | 'grant.monthly'
  | 'grant.subscription'
  | 'grant.adjustment'
  | 'grant.purchase'
  | 'reversal.purchase'
  | 'spend.translate'
  | 'spend.explain'
  | 'spend.dictation'

export async function getBalance(db: Client, userId: string): Promise<number> {
  const result = await db.query<{ credits_balance: number }>(
    `select credits_balance from users where auth_user_id = $1`,
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
       where auth_user_id = $1 and credits_balance >= $2`,
      [userId, estimate],
    )
    if (updated.rowCount === 0) {
      await db.query('rollback')
      return null
    }
    const ledger = await db.query<{ id: string }>(
      `insert into credit_ledger (user_id, delta, reason, metadata)
       values ($1, $2, $3, $4) returning id`,
      [
        userId,
        -estimate,
        reason,
        JSON.stringify({ reservation: true, estimate }),
      ],
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
// in one transaction, so the balance==ledger invariant is preserved. The delta
// is computed here, not in SQL: `$2 - $3` has two untyped parameters and
// Postgres rejects it ("operator is not unique: unknown - unknown").
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
         set credits_balance = credits_balance + $2,
             updated_at = now()
       where auth_user_id = $1`,
      [userId, reservation.reserved - cost.credits],
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
          costUsd: cost.costUsd,
          markupPercent: cost.markupPercent,
          creditsPerUsd: CREDITS_PER_USD,
        }),
      ],
    )
    const result = await db.query<{ credits_balance: number }>(
      `select credits_balance from users where auth_user_id = $1`,
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
       where auth_user_id = $1`,
      [userId, reservation.reserved],
    )
    await db.query(`delete from credit_ledger where id = $1`, [
      reservation.ledgerId,
    ])
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
  reason: Extract<
    LedgerReason,
    'grant.signup' | 'grant.monthly' | 'grant.adjustment'
  >,
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
       where auth_user_id = $1`,
      [userId, amount, reason],
    )
    await db.query(
      `insert into credit_ledger (user_id, delta, reason, metadata)
       values ($1, $2, $3, $4)`,
      [userId, amount, reason, JSON.stringify(metadata)],
    )
    const result = await db.query<{ credits_balance: number }>(
      `select credits_balance from users where auth_user_id = $1`,
      [userId],
    )
    await db.query('commit')
    return result.rows[0]?.credits_balance ?? 0
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  }
}

// users.credits_balance and credit_ledger.delta are Postgres `int` columns.
const MAX_POSTGRES_INT = 2_147_483_647

const isTokenCount = (value: number) =>
  Number.isSafeInteger(value) && value >= 0

export function creditMarkupPercent(
  env: Pick<Bindings, 'CREDIT_MARKUP_PERCENT'>,
): number {
  const configured = env.CREDIT_MARKUP_PERCENT?.trim()
  const percent = configured
    ? Number(configured)
    : DEFAULT_CREDIT_MARKUP_PERCENT
  if (!Number.isFinite(percent) || percent < 0)
    throw new Error('Invalid credit markup percentage')
  return percent
}

function creditsForCost(costUsd: number, markupPercent: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error('Invalid provider cost')
  if (!Number.isFinite(markupPercent) || markupPercent < 0)
    throw new Error('Invalid credit markup percentage')
  const credits = ceilScaledWithPercent(costUsd, CREDITS_PER_USD, markupPercent)
  if (credits > BigInt(MAX_POSTGRES_INT))
    throw new Error('Credit charge exceeds supported range')
  return Math.max(1, Number(credits))
}

// Provider cost includes all attempts and is authoritative even when token
// counts are absent. Without a complete cost report, settle at the marked-up
// hold rather than guessing a price from tokens or charging a partial cost.
export function computeCredits(
  usage: TokenUsage,
  hold: number,
  markupPercent = DEFAULT_CREDIT_MARKUP_PERCENT,
): CreditCost {
  const { promptTokens, completionTokens } = usage
  if (
    (promptTokens !== null && !isTokenCount(promptTokens)) ||
    (completionTokens !== null && !isTokenCount(completionTokens)) ||
    (promptTokens !== null &&
      completionTokens !== null &&
      !Number.isSafeInteger(promptTokens + completionTokens))
  )
    throw new Error('Invalid token usage')
  return {
    ...usage,
    markupPercent,
    credits:
      usage.costUsd === undefined
        ? hold
        : creditsForCost(usage.costUsd, markupPercent),
  }
}

// Temporary hold including prompt/schema overhead and structured output.
// The legacy Luna sample approximates seven million tokens per USD; this is
// only a reservation heuristic, never the settled price when cost is reported.
export function estimateCredits(
  text: string,
  markupPercent = DEFAULT_CREDIT_MARKUP_PERCENT,
): number {
  const inputTokens = Math.ceil(text.length / 4)
  return creditsForCost((2200 + inputTokens * 3) / 7_000_000, markupPercent)
}
