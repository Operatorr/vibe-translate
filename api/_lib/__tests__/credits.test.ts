import { describe, expect, it } from 'vitest'
import type { Client } from 'pg'

import { toCredits } from '../credit-units'

import {
  computeCredits,
  creditMarkupPercent,
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
const HOLD = 287

describe('computeCredits', () => {
  it('converts provider cost to credits and adds the default 30% markup', () => {
    expect(
      toCredits(computeCredits(usage(773, 59, 0.0001068), HOLD).credits),
    ).toBe(98)
    expect(computeCredits(usage(800, 0, 0.001), HOLD).credits).toBe(910)
  })
  it('prices the provider cost rather than token volume', () => {
    expect(computeCredits(usage(773, 59, 0.00004), HOLD)).toMatchObject({
      credits: 37,
      costUsd: 0.00004,
      markupPercent: 30,
    })
    expect(computeCredits(usage(1, 0, 0.001), HOLD).credits).toBe(910)
    expect(computeCredits(usage(773, 59, 0.001), HOLD, 50).credits).toBe(1050)
    expect(computeCredits(usage(773, 59, 0.001), HOLD, 0).credits).toBe(700)
  })
  it('rounds up and has a minimum one-credit charge', () => {
    expect(computeCredits(usage(10, 15, 0.000025), HOLD).credits).toBe(23)
    expect(computeCredits(usage(1, 0, 0.0000001), HOLD).credits).toBe(1)
    expect(computeCredits(usage(0, 0, 0), HOLD).credits).toBe(1)
  })
  it('does not bill an extra credit for floating-point noise at an exact boundary', () => {
    // 0.0041 × 700,000 × 1.3 is 3731 exactly but 3731.000000000001 in floats.
    expect(
      computeCredits(
        {
          modelId: 'test',
          promptTokens: 1,
          completionTokens: 0,
          costUsd: 0.0041,
        },
        HOLD,
      ).credits,
    ).toBe(3731)
    expect(computeCredits(usage(1, 0, 0.001), HOLD, 12.5).credits).toBe(788)
    expect(computeCredits(usage(1, 0, 0.00000100001), HOLD, 0).credits).toBe(1)
  })
  it.each([
    ['input', usage(null, 59, 0.01)],
    ['output', usage(773, null, 0.01)],
    ['both', usage(null, null, 0.01)],
  ])(
    'uses a complete provider cost even when %s token counts are absent',
    (_, unreported) => {
      expect(computeCredits(unreported, HOLD)).toMatchObject({
        credits: 9100,
        promptTokens: unreported.promptTokens,
        completionTokens: unreported.completionTokens,
        costUsd: 0.01,
      })
    },
  )
  it('settles at the already marked-up hold when cost is absent', () => {
    expect(computeCredits(usage(773, 59), HOLD).credits).toBe(HOLD)
    expect(computeCredits(usage(null, null), HOLD).credits).toBe(HOLD)
  })
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1e10])(
    'rejects invalid or unrepresentable provider cost %s',
    (cost) => {
      expect(() => computeCredits(usage(773, 59, cost), HOLD)).toThrow()
    },
  )
  it.each([
    [-10, 0],
    [-100, 100],
    [0.5, 0.5],
    [Number.NaN, 10],
    [Number.MAX_SAFE_INTEGER, 1],
  ])('rejects malformed counts (%s input, %s output)', (input, output) => {
    expect(() => computeCredits(usage(input, output, 0.001), HOLD)).toThrow(
      'Invalid token usage',
    )
  })
})

describe('creditMarkupPercent', () => {
  it('defaults to 30 and accepts configured percentages', () => {
    expect(creditMarkupPercent({})).toBe(30)
    expect(creditMarkupPercent({ CREDIT_MARKUP_PERCENT: '' })).toBe(30)
    expect(creditMarkupPercent({ CREDIT_MARKUP_PERCENT: '50' })).toBe(50)
    expect(creditMarkupPercent({ CREDIT_MARKUP_PERCENT: '0' })).toBe(0)
  })
  it.each(['oops', '-1', 'Infinity'])(
    'rejects invalid configuration %s',
    (value) => {
      expect(() =>
        creditMarkupPercent({ CREDIT_MARKUP_PERCENT: value }),
      ).toThrow('Invalid credit markup percentage')
    },
  )
})

describe('estimateCredits', () => {
  it('includes prompt and structured output overhead and grows with input length', () => {
    expect(estimateCredits('hi')).toBe(287)
    expect(estimateCredits('hi', 50)).toBe(331)
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
    const cost = computeCredits(usage(10, 10, 0.000002), 42)
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
    expect(JSON.parse(ledgerUpdate?.params?.[3] as string)).toMatchObject({
      costUsd: 0.000002,
      markupPercent: 30,
      creditsPerUsd: 700_000,
    })
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
