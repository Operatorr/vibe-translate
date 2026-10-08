import type { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { getOrCreateUser } from '../users'
import { tierLimits } from '../tier'
import { fixtureId, localClients, withLocalFixtures } from './local-db'

// Resolves once all `parties` have arrived.
function barrier(parties: number) {
  let arrived = 0
  let release = () => {}
  const open = new Promise<void>((resolve) => (release = resolve))
  return async () => {
    arrived += 1
    if (arrived === parties) release()
    await open
  }
}

// Explicit local-only opt-in; see local-db.ts for target resolution.
describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local database provisioning',
  () => {
    it('grants once when every first read misses, and keeps existing reads write-free', async () => {
      const [control, ...clients] = localClients(7)
      const id = fixtureId('provision')
      const email = `${id}@example.invalid`
      await withLocalFixtures(
        [control, ...clients],
        async () => {
          await Promise.all(
            [control, ...clients].map((client) => client.connect()),
          )
          await control.query(
            'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
            [id, 'Temporary provisioning test', email],
          )
          // Hold every client after its existence SELECT until all have run
          // it, so each INSERT races a row none of them saw. Promise.all alone
          // lets one INSERT commit before a slower client's SELECT.
          const arrive = barrier(clients.length)
          const firstReadRows: number[] = []
          const statements = clients.map(() => 0)
          const gated = clients.map(
            (client, i) =>
              ({
                query: async (text: string, values?: unknown[]) => {
                  const first = statements[i]++ === 0
                  try {
                    const result = await client.query(text, values)
                    if (first) firstReadRows.push(result.rows.length)
                    return result
                  } finally {
                    if (first) await arrive()
                  }
                },
              }) as unknown as Client,
          )
          const users = await Promise.all(
            gated.map((db) => getOrCreateUser(db, id, email)),
          )
          expect(firstReadRows).toEqual(clients.map(() => 0))
          // One client inserted (SELECT, INSERT); every other one hit the
          // conflict and read the winner (SELECT, INSERT, SELECT).
          expect([...statements].sort((a, b) => a - b)).toEqual([
            2,
            ...clients.slice(1).map(() => 3),
          ])
          expect(
            users.every(
              (user) =>
                user.creditsBalance === tierLimits.free.credits &&
                user.email === email,
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
            clients.map((client) => getOrCreateUser(client, id, email)),
          )
          expect(await version()).toBe(before)
        },
        () => control.query('delete from auth_users where id=$1', [id]),
      )
    }, 20_000)

    it('leaves neither user nor ledger row when the signup grant insert fails', async () => {
      const [control, tx] = localClients(2)
      const id = fixtureId('provision-rollback')
      const fn = `vt_fixture_fail_grant_${id.slice(-12)}`
      await withLocalFixtures(
        [tx, control],
        async () => {
          await Promise.all([control.connect(), tx.connect()])
          // Everything below runs in one transaction that is always rolled
          // back, so the trigger and fixture rows never become visible to
          // other sessions. CREATE TRIGGER briefly blocks other credit_ledger
          // writers on this shared database; lock_timeout keeps that bounded.
          await tx.query('begin')
          try {
            await tx.query(`set local lock_timeout = '5s'`)
            await tx.query(
              'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
              [id, 'Temporary rollback test', `${id}@example.invalid`],
            )
            await tx.query(
              `create function ${fn}() returns trigger language plpgsql as $$
               begin
                 if new.user_id = tg_argv[0] then
                   raise exception 'fixture: signup grant rejected';
                 end if;
                 return new;
               end $$`,
            )
            await tx.query(
              `create trigger ${fn} before insert on credit_ledger
               for each row execute function ${fn}('${id}')`,
            )
            await tx.query('savepoint provision')
            await expect(
              getOrCreateUser(tx, id, `${id}@example.invalid`),
            ).rejects.toThrow('fixture: signup grant rejected')
            await tx.query('rollback to savepoint provision')
            const rows = await tx.query(
              `select (select count(*)::int from users where auth_user_id = $1) as users,
                      (select count(*)::int from credit_ledger where user_id = $1) as ledger`,
              [id],
            )
            expect(rows.rows[0]).toEqual({ users: 0, ledger: 0 })
          } finally {
            await tx.query('rollback')
          }
          const leftovers = await control.query(
            `select (select count(*)::int from auth_users where id = $1) as auth_users,
                    (select count(*)::int from pg_trigger where tgname = $2) as triggers`,
            [id, fn],
          )
          expect(leftovers.rows[0]).toEqual({ auth_users: 0, triggers: 0 })
        },
        () => control.query('delete from auth_users where id=$1', [id]),
      )
    }, 20_000)
  },
)
