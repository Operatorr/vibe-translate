import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  computeCredits,
  estimateCredits,
  reconcileSpend,
  refundReservation,
  reserveCredits,
} from '../credits'
import { getOrCreateUser } from '../users'
import { tierLimits } from '../tier'
import { fixtureId, localClients, withLocalFixtures } from './local-db'

// The unit tests in credits.test.ts use a fake client, so they cannot catch
// SQL Postgres rejects at plan time (e.g. untyped `$2 - $3` arithmetic). This
// runs the real statements and checks sum(credit_ledger.delta) == balance.
async function state(db: Client, id: string) {
  const res = await db.query<{ balance: number; ledger: number; rows: number }>(
    `select (select credits_balance from users where auth_user_id = $1) as balance,
            (select coalesce(sum(delta), 0)::int from credit_ledger where user_id = $1) as ledger,
            (select count(*)::int from credit_ledger where user_id = $1) as rows`,
    [id],
  )
  return res.rows[0]
}

// Explicit local-only opt-in; see local-db.ts for target resolution.
describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local database credits',
  () => {
    it('charges total usage once per translation and does not spend credits for a rejected third request', async () => {
      const [db] = localClients(1)
      const id = fixtureId('two-translations')
      const email = `${id}@example.invalid`
      await withLocalFixtures(
        [db],
        async () => {
          await db.connect()
          await db.query(
            'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
            [id, 'Credit usage fixture', email],
          )
          await getOrCreateUser(db, id, email)
          const estimate = estimateCredits(
            'The food was very good, thank you!',
            1,
          )
          // Illustrative recorded provider usage: 99 output tokens is only one
          // part of the charge. The reservation is replaced, never added to it.
          const cost = computeCredits(350, 99, 'test/model', 1)
          for (let n = 0; n < 2; n++) {
            const held = await reserveCredits(
              db,
              id,
              estimate,
              'spend.translate',
            )
            expect(held).not.toBeNull()
            await reconcileSpend(db, id, held!, cost, randomUUID())
          }
          const remaining = tierLimits.free.credits - 2 * cost.credits
          expect(remaining).toBe(102)
          expect(await state(db, id)).toEqual({
            balance: remaining,
            ledger: remaining,
            rows: 3,
          })
          expect(
            await reserveCredits(db, id, estimate, 'spend.translate'),
          ).toBeNull()
          expect(await state(db, id)).toEqual({
            balance: remaining,
            ledger: remaining,
            rows: 3,
          })
        },
        () => db.query('delete from auth_users where id=$1', [id]),
      )
    }, 20_000)
    it('reserves, reconciles and refunds with the ledger matching the balance', async () => {
      const [db] = localClients(1)
      const id = fixtureId('credits')
      const email = `${id}@example.invalid`
      await withLocalFixtures(
        [db],
        async () => {
          await db.connect()
          await db.query(
            'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
            [id, 'Temporary credits test', email],
          )
          await getOrCreateUser(db, id, email)
          const start = tierLimits.free.credits

          const held = await reserveCredits(db, id, 40, 'spend.translate')
          expect(held).not.toBeNull()
          expect(await state(db, id)).toEqual({
            balance: start - 40,
            ledger: start - 40,
            rows: 2,
          })

          const cost = computeCredits(10, 15, 'model-x', 1)
          const balance = await reconcileSpend(
            db,
            id,
            held!,
            cost,
            randomUUID(),
          )
          expect(balance).toBe(start - cost.credits)
          expect(await state(db, id)).toEqual({
            balance,
            ledger: balance,
            rows: 2,
          })

          const refunded = await reserveCredits(db, id, 30, 'spend.explain')
          await refundReservation(db, id, refunded!)
          expect(await state(db, id)).toEqual({
            balance,
            ledger: balance,
            rows: 2,
          })

          expect(
            await reserveCredits(db, id, balance + 1, 'spend.translate'),
          ).toBeNull()
        },
        () => db.query('delete from auth_users where id=$1', [id]),
      )
    }, 20_000)
  },
)
