import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { processDodoWebhook, type DodoEvent } from '../payments'
import { getOrCreateUser } from '../users'
import { fixtureId, localClients, withLocalFixtures } from './local-db'

describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local database credit purchases',
  () => {
    it('grants once under concurrent webhook deliveries and keeps balance equal to the ledger', async () => {
      const clients = localClients(2)
      const [db] = clients
      const userId = fixtureId('topup')
      const email = `${userId}@example.invalid`
      const orderId = randomUUID()
      const paymentId = randomUUID()
      const events = [fixtureId('event'), fixtureId('event')]
      await withLocalFixtures(
        clients,
        async () => {
          await Promise.all(clients.map((client) => client.connect()))
          await db.query(
            'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
            [userId, 'Credit purchase fixture', email],
          )
          const user = await getOrCreateUser(db, userId, email)
          await db.query(
            `insert into credit_purchases(id,user_id,product_id,quantity,credits) values($1,$2,'test-product',1,25000)`,
            [orderId, userId],
          )
          const event: DodoEvent = {
            type: 'payment.succeeded',
            data: {
              payment_id: paymentId,
              status: 'succeeded',
              product_cart: [{ product_id: 'test-product', quantity: 1 }],
              metadata: {
                kind: 'credit_topup',
                order_id: orderId,
                user_id: userId,
              },
            },
          }
          const results = await Promise.all(
            clients.map((client, index) =>
              processDodoWebhook(client, {}, events[index], event),
            ),
          )
          expect(results.map((result) => result.status).sort()).toEqual([
            'deduped',
            'processed',
          ])
          const state = await db.query<{
            balance: number
            ledger: number
            purchases: number
          }>(
            `select credits_balance as balance,
          (select sum(delta)::int from credit_ledger where user_id=$1) as ledger,
          (select count(*)::int from credit_ledger where user_id=$1 and reason='grant.purchase') as purchases
          from users where auth_user_id=$1`,
            [userId],
          )
          expect(state.rows[0]).toEqual({
            balance: user.creditsBalance + 25000,
            ledger: user.creditsBalance + 25000,
            purchases: 1,
          })
          expect(await processDodoWebhook(db, {}, events[0], event)).toEqual({
            status: 'deduped',
          })
          await db.query(
            'delete from webhook_events where event_id = any($1::text[])',
            [events],
          )
        },
        async () => {
          // Dedupe records have no user FK; clean even if an assertion fails.
          await db.query(
            'delete from webhook_events where event_id = any($1::text[])',
            [events],
          )
          await db.query('delete from auth_users where id=$1', [userId])
        },
      )
    }, 30_000)
  },
)
