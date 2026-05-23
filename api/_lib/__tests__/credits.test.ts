import { describe, expect, it } from 'vitest'
import type { Client } from 'pg'

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
    if (s.startsWith('update users')) return Promise.resolve({ rowCount: rowCounts.updateUsers ?? 1, rows: [] })
    if (s.startsWith('insert into credit_ledger')) return Promise.resolve({ rowCount: 1, rows: [{ id: 'ledger-1' }] })
    if (s.startsWith('update credit_ledger')) return Promise.resolve({ rowCount: 1, rows: [] })
    if (s.startsWith('delete from credit_ledger')) return Promise.resolve({ rowCount: 1, rows: [] })
    if (s.startsWith('select credits_balance')) return Promise.resolve({ rowCount: 1, rows: [{ credits_balance: balance }] })
    return Promise.resolve({ rowCount: 0, rows: [] }) // begin / commit / rollback
  }
  return { db: { query } as unknown as Client, calls }
}

describe('computeCredits', () => {
  it('floors at 1 credit and scales by the multiplier', () => {
    expect(computeCredits(0, 0, 'm', 1).credits).toBe(1)
    expect(computeCredits(100, 100, 'm', 0.5).credits).toBe(100)
    expect(computeCredits(10, 10, 'm', 0.01).credits).toBe(1) // ceil(0.2) -> max(1, …)
  })
})

describe('estimateCredits', () => {
  it('grows with input length and scales by the multiplier', () => {
    const short = estimateCredits('hi', 1)
    const long = estimateCredits('x'.repeat(4000), 1)
    expect(long).toBeGreaterThan(short)
    expect(estimateCredits('hi', 0)).toBe(1) // never below 1
  })
})

describe('reserveCredits', () => {
  it('returns a handle and writes a pending ledger row on success', async () => {
    const { db, calls } = fakeClient({ updateUsers: 1 })
    const reservation = await reserveCredits(db, 'user-1', 42, 'spend.translate')
    expect(reservation).toEqual({ ledgerId: 'ledger-1', reserved: 42 })
    expect(calls.some((c) => c.sql.startsWith('insert into credit_ledger'))).toBe(true)
    expect(calls.some((c) => c.sql === 'commit')).toBe(true)
  })

  it('returns null and rolls back when the balance cannot cover the hold', async () => {
    const { db, calls } = fakeClient({ updateUsers: 0 })
    const reservation = await reserveCredits(db, 'user-1', 42, 'spend.translate')
    expect(reservation).toBeNull()
    expect(calls.some((c) => c.sql.startsWith('insert into credit_ledger'))).toBe(false)
    expect(calls.some((c) => c.sql === 'rollback')).toBe(true)
  })
})

describe('reconcileSpend', () => {
  it('rewrites the pending ledger row to the actual cost', async () => {
    const { db, calls } = fakeClient({}, 58)
    const cost = computeCredits(10, 10, 'model-x', 1)
    const balance = await reconcileSpend(db, 'user-1', { ledgerId: 'ledger-1', reserved: 42 }, cost, 'seg-1')
    expect(balance).toBe(58)
    const ledgerUpdate = calls.find((c) => c.sql.startsWith('update credit_ledger'))
    expect(ledgerUpdate?.params).toContain(-cost.credits)
    expect(ledgerUpdate?.params).toContain('seg-1')
  })
})

describe('refundReservation', () => {
  it('credits the hold back and deletes the pending ledger row', async () => {
    const { db, calls } = fakeClient()
    await refundReservation(db, 'user-1', { ledgerId: 'ledger-1', reserved: 42 })
    const refund = calls.find((c) => c.sql.startsWith('update users'))
    expect(refund?.params).toEqual(['user-1', 42])
    expect(calls.some((c) => c.sql.startsWith('delete from credit_ledger'))).toBe(true)
  })
})
