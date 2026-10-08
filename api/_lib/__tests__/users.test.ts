import type { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { getOrCreateUser } from '../users'

const row = {
  auth_user_id: 'a',
  email: 'a@example.com',
  display_name: null,
  tier: 'free',
  onboarding_complete: false,
  credits_balance: 100,
  credits_refilled_at: null,
  byok_configured: false,
  openrouter_api_key_last4: null,
  byok_translate_model_id: null,
  byok_explain_model_id: null,
  locale: null,
}

describe('user provisioning reads', () => {
  it('does not write unchanged users across separate requests', async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [row] }))
    for (let i = 0; i < 4; i++) {
      await getOrCreateUser({ query } as unknown as Client, 'a', row.email)
    }
    expect(query).toHaveBeenCalledTimes(4)
    expect(
      query.mock.calls.every(([sql]) => /^select /i.test(String(sql))),
    ).toBe(true)
  })
  it('updates email only when the authenticated email changed', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, email: 'new@example.com' }] })
    const user = await getOrCreateUser(
      { query } as unknown as Client,
      'a',
      'new@example.com',
    )
    expect(user.email).toBe('new@example.com')
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toMatch(/^update users/i)
  })
  it('provisions balance and signup ledger atomically, then reads a concurrent winner', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
    const user = await getOrCreateUser(
      { query } as unknown as Client,
      'a',
      row.email,
    )
    expect(user.userId).toBe('a')
    expect(query.mock.calls[1][0]).toContain('insert into credit_ledger')
    expect(query.mock.calls[1][0]).toContain(
      'on conflict (auth_user_id) do nothing',
    )
    expect(query.mock.calls).toHaveLength(3)
  })
})
