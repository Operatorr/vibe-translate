import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { localClients, withLocalFixtures } from './local-db'

describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'cost-unit migration',
  () => {
    it('converts legacy balances, grants, Luna charges and refund snapshots together', async () => {
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
        insert into users values ('free', 9168), ('paid', 24558);
        insert into credit_purchases values (25000);
        insert into credit_ledger values
          (1, 'free', 10000, 'grant.signup', '{}'),
          (2, 'free', -832, 'spend.translate', '{"modelId":"openai/gpt-6-luna","promptTokens":773,"completionTokens":59}'),
          (3, 'paid', 25000, 'grant.subscription', '{}'),
          (4, 'paid', 25000, 'grant.purchase', '{}'),
          (5, 'paid', -25000, 'reversal.purchase', '{}'),
          (6, 'paid', -400, 'spend.translate', '{"modelId":"unknown"}'),
          (7, 'paid', -42, 'spend.translate', '{"reservation":true,"estimate":42}');
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
          const state =
            await db.query(`select u.auth_user_id, u.credits_balance, u.billing_period,
        (select sum(delta)::int from credit_ledger l where l.user_id = u.auth_user_id) as ledger
        from users u order by auth_user_id`)
          expect(state.rows).toEqual([
            {
              auth_user_id: 'free',
              credits_balance: 99893,
              ledger: 99893,
              billing_period: 'monthly',
            },
            {
              auth_user_id: 'paid',
              credits_balance: 2455800,
              ledger: 2455800,
              billing_period: 'monthly',
            },
          ])
          expect(
            (await db.query('select credits from credit_purchases')).rows[0]
              .credits,
          ).toBe(2500000)
          expect(
            (
              await db.query(
                'select delta, metadata from credit_ledger where id=7',
              )
            ).rows[0],
          ).toMatchObject({
            delta: -4200,
            metadata: { estimate: 4200, legacyCredits: -42 },
          })
          const segments = (await db.query('select token_usage from segments'))
            .rows
          expect(segments.map((row) => row.token_usage.creditsCharged)).toEqual(
            [107, 0],
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
