import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { localClients, withLocalFixtures } from './local-db'

describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'credit-unit migrations',
  () => {
    it('converts balances, token charges and refund snapshots to whole Credits', async () => {
      const [db] = localClients(1)
      await withLocalFixtures(
        [db],
        async () => {
          await db.connect()
          await db.query('begin')
          // Temp tables shadow real relations. The migration never touches local
          // account data, and rollback removes every fixture and schema change.
          await db.query(`
        create temp table users (auth_user_id text primary key, credits_balance integer);
        create temp table credit_purchases (credits integer);
        create temp table credit_ledger (id integer primary key, user_id text, delta integer, reason text, metadata jsonb);
        create temp table segments (token_usage jsonb);
        create temp table models (task text, provider text, provider_model_id text, display_name text,
          is_default boolean, updated_at timestamptz default now(), unique(task, provider, provider_model_id));
        -- 'free' and 'paid' match their ledgers. 'noledger' has a balance and no
        -- rows; 'ahead' and 'behind' differ from their ledger by +3 and -5.
        insert into users values ('free', 9168), ('paid', 24558),
          ('noledger', 7), ('ahead', 103), ('behind', 95);
        insert into credit_purchases values (25000);
        insert into credit_ledger values
          (1, 'free', 10000, 'grant.signup', '{}'),
          (2, 'free', -832, 'spend.translate', '{"modelId":"openai/gpt-6-luna","promptTokens":773,"completionTokens":59}'),
          (3, 'paid', 25000, 'grant.subscription', '{}'),
          (4, 'paid', 25000, 'grant.purchase', '{}'),
          (5, 'paid', -25000, 'reversal.purchase', '{}'),
          (6, 'paid', -400, 'spend.translate', '{"modelId":"unknown"}'),
          (7, 'paid', -42, 'spend.translate', '{"reservation":true,"estimate":42}'),
          (8, 'ahead', 100, 'grant.adjustment', '{}'),
          (9, 'behind', 100, 'grant.adjustment', '{}');
        insert into segments values
          ('{"modelId":"openai/gpt-6-luna","promptTokens":773,"completionTokens":59,"creditsCharged":832}'),
          ('{"creditsCharged":0}');
      `)
          const migration = await readFile(
            new URL(
              '../../../db/migrations/0012_cost_based_credits.sql',
              import.meta.url,
            ),
            'utf8',
          )
          await db.query(migration)
          await db.query(
            await readFile(
              new URL(
                '../../../db/migrations/0014_token_based_credits.sql',
                import.meta.url,
              ),
              'utf8',
            ),
          )
          const state =
            await db.query(`select u.auth_user_id, u.credits_balance, u.billing_period,
        (select sum(delta)::int from credit_ledger l where l.user_id = u.auth_user_id) as ledger
        from users u order by auth_user_id`)
          // Unledgered value converts at the same 0.7 rate as ledgered value:
          // 7 legacy Credits = 700 units → 490; +300 → +210; -500 → -350.
          expect(state.rows).toEqual([
            {
              auth_user_id: 'ahead',
              credits_balance: 7210,
              ledger: 7000,
              billing_period: 'monthly',
            },
            {
              auth_user_id: 'behind',
              credits_balance: 6650,
              ledger: 7000,
              billing_period: 'monthly',
            },
            {
              auth_user_id: 'free',
              credits_balance: 49917,
              ledger: 49917,
              billing_period: 'monthly',
            },
            {
              auth_user_id: 'noledger',
              credits_balance: 490,
              ledger: null,
              billing_period: 'monthly',
            },
            {
              auth_user_id: 'paid',
              credits_balance: 1719060,
              ledger: 1719060,
              billing_period: 'monthly',
            },
          ])
          expect(
            (await db.query('select credits from credit_purchases')).rows[0]
              .credits,
          ).toBe(1750000)
          expect(
            (
              await db.query(
                'select delta, metadata from credit_ledger where id=7',
              )
            ).rows[0],
          ).toMatchObject({
            delta: -2940,
            metadata: {
              estimate: 2940,
              legacyCredits: -42,
              previousAccountingUnits: -4200,
            },
          })
          const segments = (await db.query('select token_usage from segments'))
            .rows
          expect(segments.map((row) => row.token_usage.creditsCharged)).toEqual(
            [83, 0],
          )
          expect(
            (
              await db.query(
                "select provider_model_id from models where task='translate' and is_default",
              )
            ).rows[0].provider_model_id,
          ).toBe('openai/gpt-6-luna')
        },
        () => db.query('rollback'),
      )
    }, 20_000)
  },
)
