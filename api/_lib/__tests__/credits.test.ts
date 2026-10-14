import { describe, expect, it } from 'vitest'
import type { Client } from 'pg'

import { toCredits } from '../credit-units'

import {
  computeCredits,
  estimateCredits,
  reconcileSpend,
  refundReservation,
  reserveCredits,
} from '../credits'

// Minimal fake pg Client: records every query and returns a scripted result
// keyed by a substring of the SQL. Enough to exercise the orchestration in
// credits.ts (transaction framing, the conditional-reservation branch, and the
// ledger rewrite). The atomic `credits_balance >= $2` guard itself is enforced
// by Postgres and is out of scope for a unit test.
function fakeClient(rowCounts: Record<string, number> = {}, balance = 100) {
  const calls: { sql: string; params?: unknown[] }[] = []
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase()
  const query = (sql: string, params?: unknown[]) => {
    calls.push({ sql: norm(sql), params })
    const s = norm(sql)
    if (s.startsWith('update users'))
      return Promise.resolve({ rowCount: rowCounts.updateUsers ?? 1, rows: [] })
    if (s.startsWith('insert into credit_ledger'))
      return Promise.resolve({ rowCount: 1, rows: [{ id: 'ledger-1' }] })
    if (s.startsWith('update credit_ledger'))
      return Promise.resolve({ rowCount: 1, rows: [] })
    if (s.startsWith('delete from credit_ledger'))
      return Promise.resolve({ rowCount: 1, rows: [] })
    if (s.startsWith('select credits_balance'))
      return Promise.resolve({
        rowCount: 1,
        rows: [{ credits_balance: balance }],
      })
    return Promise.resolve({ rowCount: 0, rows: [] }) // begin / commit / rollback
  }
  return { db: { query } as unknown as Client, calls }
}

const usage = (
  promptTokens: number | null,
  completionTokens: number | null,
  costUsd?: number,
) => ({ promptTokens, completionTokens, modelId: 'openai/gpt-6-luna', costUsd })
const HOLD = 221

describe('computeCredits', () => {
  it('charges 83 whole Credits for the screenshot’s 773 input + 59 output tokens', () => {
    expect(
      toCredits(computeCredits(usage(773, 59, 0.0001068), HOLD).credits),
    ).toBe(83)
    expect(computeCredits(usage(796, 91), HOLD).credits).toBe(89)
    expect(computeCredits(usage(788, 127), HOLD).credits).toBe(92)
  })
  it('keeps USD cost for audit without using it to set the token charge', () => {
    expect(computeCredits(usage(773, 59, 0.00004), HOLD)).toMatchObject({
      credits: 83,
      costUsd: 0.00004,
    })
    expect(computeCredits(usage(773, 59), HOLD).credits).toBe(83)
  })
  it('rounds half credits upward and has a minimum one-credit call charge', () => {
    expect(computeCredits(usage(10, 15), HOLD).credits).toBe(3)
    expect(computeCredits(usage(1, 0), HOLD).credits).toBe(1)
    expect(computeCredits(usage(0, 0), HOLD).credits).toBe(1)
  })
  it.each([
    ['input', usage(null, 59, 0.01)],
    ['output', usage(773, null, 0.01)],
    ['both', usage(null, null, 0.01)],
  ])(
    'settles at the hold when %s token counts are unreported',
    (_, unreported) => {
      expect(computeCredits(unreported, HOLD)).toMatchObject({
        credits: HOLD,
        promptTokens: unreported.promptTokens,
        completionTokens: unreported.completionTokens,
        costUsd: 0.01,
      })
    },
  )
  it.each([
    [-10, 0],
    [-100, 100],
    [0.5, 0.5],
    [Number.NaN, 10],
    [Number.MAX_SAFE_INTEGER, 1],
  ])('rejects malformed counts (%s input, %s output)', (input, output) => {
    expect(() => computeCredits(usage(input, output), HOLD)).toThrow(
      'Invalid token usage',
    )
  })
})

describe('estimateCredits', () => {
  it('includes prompt and structured output overhead and grows with input length', () => {
    expect(estimateCredits('hi')).toBe(221)
    expect(estimateCredits('x'.repeat(4000))).toBeGreaterThan(
      estimateCredits('hi'),
    )
  })
})

describe('reserveCredits', () => {
  it('returns a handle and writes a pending ledger row on success', async () => {
    const { db, calls } = fakeClient({ updateUsers: 1 })
    const reservation = await reserveCredits(
      db,
      'user-1',
      42,
      'spend.translate',
    )
    expect(reservation).toEqual({ ledgerId: 'ledger-1', reserved: 42 })
    expect(
      calls.some((c) => c.sql.startsWith('insert into credit_ledger')),
    ).toBe(true)
    expect(calls.some((c) => c.sql === 'commit')).toBe(true)
  })

  it('returns null and rolls back when the balance cannot cover the hold', async () => {
    const { db, calls } = fakeClient({ updateUsers: 0 })
    const reservation = await reserveCredits(
      db,
      'user-1',
      42,
      'spend.translate',
    )
    expect(reservation).toBeNull()
    expect(
      calls.some((c) => c.sql.startsWith('insert into credit_ledger')),
    ).toBe(false)
    expect(calls.some((c) => c.sql === 'rollback')).toBe(true)
  })
})

describe('reconcileSpend', () => {
  it('rewrites the pending ledger row to the actual cost', async () => {
    const { db, calls } = fakeClient({}, 58)
    const cost = computeCredits(usage(10, 10), 42)
    const balance = await reconcileSpend(
      db,
      'user-1',
      { ledgerId: 'ledger-1', reserved: 42 },
      cost,
      'seg-1',
    )
    expect(balance).toBe(58)
    // One precomputed delta param: `$2 - $3` with two untyped params fails in Postgres.
    const balanceUpdate = calls.find((c) => c.sql.startsWith('update users'))
    expect(balanceUpdate?.params).toEqual(['user-1', 42 - cost.credits])
    const ledgerUpdate = calls.find((c) =>
      c.sql.startsWith('update credit_ledger'),
    )
    expect(ledgerUpdate?.params).toContain(-cost.credits)
    expect(ledgerUpdate?.params).toContain('seg-1')
  })
})

describe('refundReservation', () => {
  it('credits the hold back and deletes the pending ledger row', async () => {
    const { db, calls } = fakeClient()
    await refundReservation(db, 'user-1', {
      ledgerId: 'ledger-1',
      reserved: 42,
    })
    const refund = calls.find((c) => c.sql.startsWith('update users'))
    expect(refund?.params).toEqual(['user-1', 42])
    expect(
      calls.some((c) => c.sql.startsWith('delete from credit_ledger')),
    ).toBe(true)
  })
})
