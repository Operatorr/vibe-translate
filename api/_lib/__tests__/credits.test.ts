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

const luna = { prompt: 0.0000001, completion: 0.0000005, request: 0 }
const usage = (
  promptTokens: number,
  completionTokens: number,
  costUsd?: number,
) => ({ promptTokens, completionTokens, modelId: 'openai/gpt-6-luna', costUsd })

describe('computeCredits', () => {
  it('matches the screenshot: 773 input + 59 output tokens cost 10.7 Credits', () => {
    expect(computeCredits(usage(773, 59, 0.0001068), luna).credits).toBe(107)
    expect(computeCredits(usage(773, 59), luna).credits).toBe(107)
    expect(toCredits(computeCredits(usage(773, 59), luna).credits)).toBe(10.7)
  })
  it('uses actual provider cost including caching discounts over catalog estimates', () => {
    expect(computeCredits(usage(773, 59, 0.00004), luna).credits).toBe(40)
    expect(computeCredits(usage(773, 59, 0), luna).credits).toBe(0)
  })
  it('preserves sub-cent precision and avoids rounding exact boundaries twice', () => {
    expect(computeCredits(usage(780, 90, 0.000123), luna).credits).toBe(123)
    expect(computeCredits(usage(10, 10, 0.0000002), luna).credits).toBe(1)
    expect(() => computeCredits(usage(0, 0, -1), luna)).toThrow()
  })
  it('accounts for per-request prices when cost reporting is absent', () => {
    expect(
      computeCredits(
        { ...usage(0, 0), requests: 2 },
        { ...luna, request: 0.001 },
      ).credits,
    ).toBe(2000)
  })
})

describe('estimateCredits', () => {
  it('grows with input length and uses the chosen model’s input/output rates', () => {
    expect(estimateCredits('x'.repeat(4000), luna)).toBeGreaterThan(
      estimateCredits('hi', luna),
    )
    expect(
      estimateCredits('hi', { prompt: 0, completion: 0, request: 0 }),
    ).toBe(1)
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
    const cost = computeCredits(usage(10, 10), luna)
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
