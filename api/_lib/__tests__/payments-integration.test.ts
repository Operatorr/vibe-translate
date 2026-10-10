import { randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import type { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { reserveCredits } from '../credits'
import { processDodoWebhook, type DodoEvent } from '../payments'
import { getOrCreateUser } from '../users'
import { fixtureId, localClients, withLocalFixtures } from './local-db'

const CREDITS = 25000

const payment = (
  orderId: string,
  userId: string,
  paymentId: string,
): DodoEvent => ({
  type: 'payment.succeeded',
  data: {
    payment_id: paymentId,
    status: 'succeeded',
    product_cart: [{ product_id: 'test-product', quantity: 1 }],
    metadata: { kind: 'credit_topup', order_id: orderId, user_id: userId },
  },
})

// Creates the auth identity, app profile (with its signup grant) and orders.
async function seed(db: Client, userId: string, orderIds: string[]) {
  await db.query(
    'insert into auth_users(id,name,email,email_verified) values($1,$2,$3,true)',
    [userId, 'Credit purchase fixture', `${userId}@example.invalid`],
  )
  const user = await getOrCreateUser(db, userId, `${userId}@example.invalid`)
  for (const orderId of orderIds)
    await db.query(
      `insert into credit_purchases(id,user_id,product_id,quantity,credits) values($1,$2,'test-product',1,$3)`,
      [orderId, userId, CREDITS],
    )
  return user.creditsBalance
}

async function accounts(db: Client, userId: string) {
  const result = await db.query<{
    balance: number
    ledger: number
    grants: number
    reversals: number
  }>(
    `select credits_balance as balance,
       (select sum(delta)::int from credit_ledger where user_id=$1) as ledger,
       (select count(*)::int from credit_ledger where user_id=$1 and reason='grant.purchase') as grants,
       (select count(*)::int from credit_ledger where user_id=$1 and reason='reversal.purchase') as reversals
     from users where auth_user_id=$1`,
    [userId],
  )
  return result.rows[0]
}

// Values of settled promises; rethrows only once every promise has settled.
function settledValues<T>(results: PromiseSettledResult<T>[]): T[] {
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, 'Webhook deliveries failed')
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

// pg_stat_activity is snapshotted per transaction, so poll from a client that
// is not inside one.
async function waitForLockWaiters(db: Client, pids: number[]) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const result = await db.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where pid = any($1::int[]) and wait_event_type = 'Lock'`,
      [pids],
    )
    if (result.rows[0].waiting === pids.length) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Webhook deliveries never both waited on the order lock')
}

describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local database credit purchases',
  () => {
    it('grants once when two deliveries contend for the order lock and keeps balance equal to the ledger', async () => {
      const clients = localClients(4)
      const [db, first, second, control] = clients
      const userId = fixtureId('topup')
      const orderId = randomUUID()
      const event = payment(orderId, userId, randomUUID())
      const events = [fixtureId('event'), fixtureId('event')]
      await withLocalFixtures(
        clients,
        async () => {
          await Promise.all(clients.map((client) => client.connect()))
          const initial = await seed(db, userId, [orderId])
          const pids = await Promise.all(
            [first, second].map(
              async (client) =>
                (
                  await client.query<{ pid: number }>(
                    'select pg_backend_pid() as pid',
                  )
                ).rows[0].pid,
            ),
          )
          // Hold the order row so both deliveries are guaranteed to overlap.
          await control.query('begin')
          await control.query(
            'select id from credit_purchases where id = $1 for update',
            [orderId],
          )
          const deliveries = Promise.allSettled(
            [first, second].map((client, index) =>
              processDodoWebhook(client, {}, events[index], event),
            ),
          )
          const lockWait = await waitForLockWaiters(db, pids).then(
            () => null,
            (error: unknown) => ({ error }),
          )
          await control.query('rollback')
          const results = settledValues(await deliveries)
          if (lockWait) throw lockWait.error
          expect(results.map((result) => result.status).sort()).toEqual([
            'deduped',
            'processed',
          ])
          expect(await accounts(db, userId)).toEqual({
            balance: initial + CREDITS,
            ledger: initial + CREDITS,
            grants: 1,
            reversals: 0,
          })
          expect(await processDodoWebhook(db, {}, events[0], event)).toEqual({
            status: 'deduped',
          })
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

    it('rejects one payment delivered for a second order and rolls back its dedupe record', async () => {
      const clients = localClients(1)
      const [db] = clients
      const userId = fixtureId('topup-reuse')
      const orderIds = [randomUUID(), randomUUID()]
      const paymentId = randomUUID()
      const events = [fixtureId('event'), fixtureId('event')]
      await withLocalFixtures(
        clients,
        async () => {
          await db.connect()
          const initial = await seed(db, userId, orderIds)
          expect(
            await processDodoWebhook(
              db,
              {},
              events[0],
              payment(orderIds[0], userId, paymentId),
            ),
          ).toEqual({ status: 'processed', userId })
          const error = await processDodoWebhook(
            db,
            {},
            events[1],
            payment(orderIds[1], userId, paymentId),
          ).catch((reason: unknown) => reason)
          expect(error).toBeInstanceOf(HTTPException)
          expect(error).toMatchObject({
            status: 400,
            message: 'Credit payment already used',
          })
          const dedupe = await db.query<{ event_id: string }>(
            'select event_id from webhook_events where event_id = any($1::text[])',
            [events],
          )
          expect(dedupe.rows.map((row) => row.event_id)).toEqual([events[0]])
          const second = await db.query<{
            payment_id: string | null
            fulfilled_at: Date | null
          }>(
            'select payment_id, fulfilled_at from credit_purchases where id = $1',
            [orderIds[1]],
          )
          expect(second.rows[0]).toEqual({
            payment_id: null,
            fulfilled_at: null,
          })
          expect(await accounts(db, userId)).toEqual({
            balance: initial + CREDITS,
            ledger: initial + CREDITS,
            grants: 1,
            reversals: 0,
          })
        },
        async () => {
          await db.query(
            'delete from webhook_events where event_id = any($1::text[])',
            [events],
          )
          await db.query('delete from auth_users where id=$1', [userId])
        },
      )
    }, 30_000)

    it('reverses a fully refunded top-up once, even into a negative balance', async () => {
      const clients = localClients(1)
      const [db] = clients
      const userId = fixtureId('topup-refund')
      const orderId = randomUUID()
      const paymentId = randomUUID()
      const refundId = `re_${randomUUID()}`
      const events = [
        fixtureId('event'),
        fixtureId('event'),
        fixtureId('event'),
      ]
      const refund: DodoEvent = {
        type: 'refund.succeeded',
        data: {
          payment_id: paymentId,
          refund_id: refundId,
          is_partial: false,
          status: 'succeeded',
        },
      }
      await withLocalFixtures(
        clients,
        async () => {
          await db.connect()
          const initial = await seed(db, userId, [orderId])
          await processDodoWebhook(
            db,
            {},
            events[0],
            payment(orderId, userId, paymentId),
          )
          // Spend all but 100 credits so the reversal has to create debt.
          const spent = initial + CREDITS - 100
          expect(
            await reserveCredits(db, userId, spent, 'spend.translate'),
          ).not.toBeNull()
          expect(await processDodoWebhook(db, {}, events[1], refund)).toEqual({
            status: 'processed',
            userId,
          })
          expect(await accounts(db, userId)).toEqual({
            balance: 100 - CREDITS,
            ledger: 100 - CREDITS,
            grants: 1,
            reversals: 1,
          })
          const order = await db.query(
            `select reversal_id, reversal_reason, reversed_at is not null as reversed
               from credit_purchases where id = $1`,
            [orderId],
          )
          expect(order.rows[0]).toEqual({
            reversal_id: refundId,
            reversal_reason: 'refund',
            reversed: true,
          })
          const ledger = await db.query(
            `select delta, reference_id, metadata from credit_ledger
              where user_id = $1 and reason = 'reversal.purchase'`,
            [userId],
          )
          expect(ledger.rows).toEqual([
            {
              delta: -CREDITS,
              reference_id: orderId,
              metadata: { paymentId, refundId },
            },
          ])
          // A redelivery under a new event id finds the order already reversed.
          expect(await processDodoWebhook(db, {}, events[2], refund)).toEqual({
            status: 'deduped',
          })
          expect((await accounts(db, userId)).reversals).toBe(1)
          // Debt blocks platform-funded calls until later grants cover it.
          expect(
            await reserveCredits(db, userId, 1, 'spend.translate'),
          ).toBeNull()
        },
        async () => {
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
