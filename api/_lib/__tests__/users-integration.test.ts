import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { getOrCreateUser } from '../users'
import { tierLimits } from '../tier'

// Explicit local-only opt-in; never use the production Hyperdrive binding.
describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local database provisioning',
  () => {
    it('grants once under concurrent first reads and keeps existing reads write-free', async () => {
      if (process.env.APP_ENV === 'production')
        throw new Error('Refusing production fixtures')
      const connectionString =
        process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
        process.env.DATABASE_URL
      if (!connectionString) throw new Error('Local database URL required')
      const control = new Client({ connectionString })
      const clients = Array.from(
        { length: 6 },
        () => new Client({ connectionString }),
      )
      const id = `perf-provision-${randomUUID()}`
      await control.connect()
      try {
        await control.query(
          'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
          [id, 'Temporary performance test', `${id}@example.invalid`],
        )
        await Promise.all(clients.map((client) => client.connect()))
        const users = await Promise.all(
          clients.map((client) =>
            getOrCreateUser(client, id, `${id}@example.invalid`),
          ),
        )
        expect(
          users.every(
            (user) => user.creditsBalance === tierLimits.free.credits,
          ),
        ).toBe(true)
        const grant = await control.query(
          'select count(*)::int as count, sum(delta)::int as total from credit_ledger where user_id=$1',
          [id],
        )
        expect(grant.rows[0]).toEqual({
          count: 1,
          total: tierLimits.free.credits,
        })
        const version = async () =>
          (
            await control.query(
              'select xmin::text as version from users where auth_user_id=$1',
              [id],
            )
          ).rows[0].version
        const before = await version()
        await Promise.all(
          clients.map((client) =>
            getOrCreateUser(client, id, `${id}@example.invalid`),
          ),
        )
        expect(await version()).toBe(before)
      } finally {
        await control.query('delete from auth_users where id=$1', [id])
        await Promise.all(clients.map((client) => client.end()))
        await control.end()
      }
    }, 20_000)
  },
)
