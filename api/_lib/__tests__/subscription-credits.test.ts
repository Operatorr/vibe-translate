import type { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { processDodoWebhook } from '../payments'

const env = {
  DODO_PRODUCT_PRO: 'pro-monthly',
  DODO_PRODUCT_PRO_ANNUAL: 'pro-annual',
  DODO_PRODUCT_TEAM: 'team-monthly',
  DODO_PRODUCT_TEAM_ANNUAL: 'team-annual',
}
describe('subscription credit budgets', () => {
  it.each([
    ['pro', 'monthly', 3_500_000],
    ['pro', 'annual', 42_000_000],
    ['team', 'monthly', 14_000_000],
    ['team', 'annual', 168_000_000],
  ] as const)(
    'grants %s / %s the token allowance',
    async (plan, period, amount) => {
      const query = vi.fn(async () => ({ rows: [], rowCount: 1 }))
      await processDodoWebhook({ query } as unknown as Client, env, 'event-1', {
        type: 'subscription.active',
        data: {
          product_id: `${plan}-${period}`,
          subscription_id: 'sub-1',
          metadata: { user_id: 'u1', plan },
        },
      })
      const calls = query.mock.calls as unknown as [string, unknown[]][]
      const ledger = calls.find(([sql]) =>
        sql.includes('insert into credit_ledger'),
      )
      expect(ledger?.[1][1]).toBe(amount)
      const update = calls.find(([sql]) => sql.includes('set tier = $2'))
      expect(update?.[1][4]).toBe(period)
    },
  )
  it('uses the stored annual period on renewals without product or metadata period', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('select billing_period')
        ? [{ billing_period: 'annual' }]
        : [],
      rowCount: 1,
    }))
    await processDodoWebhook({ query } as unknown as Client, env, 'renewal-1', {
      type: 'subscription.renewed',
      data: {
        subscription_id: 'sub-1',
        metadata: { user_id: 'u1', plan: 'pro' },
      },
    })
    const calls = query.mock.calls as unknown as [string, unknown[]][]
    expect(
      calls.find(([sql]) => sql.includes('insert into credit_ledger'))?.[1][1],
    ).toBe(42_000_000)
  })
})
