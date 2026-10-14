-- Run transactionally with the old worker stopped/drained. Accounting becomes
-- integer microdollars; public Credits are 100 units each ($0.0001).
-- Preserve the displayed value of paid grants, purchases and reversals. Reset
-- the original welcome grant to $0.10 and reprice recorded Luna spends using
-- their input/output counts. Record legacy amounts for audit. Unknown historical
-- model costs retain their original displayed charge; never invent a USD cost.
alter table users add column if not exists billing_period text not null default 'monthly'
  check (billing_period in ('monthly', 'annual'));

update users set credits_balance = credits_balance * 100;
update credit_purchases set credits = credits * 100;

with amounts as (
  select id, user_id, delta as old_delta,
    case
      when reason = 'grant.signup' and delta > 0 then 100000
      when reason like 'spend.%' and metadata->>'reservation' is distinct from 'true'
        and (metadata->>'costUsd') ~ '^[0-9]+(\.[0-9]+)?$'
        then -ceil((metadata->>'costUsd')::numeric * 1000000)::integer
      when reason like 'spend.%' and metadata->>'reservation' is distinct from 'true'
        and metadata->>'modelId' like 'openai/gpt-6-luna%'
        and (metadata->>'promptTokens') ~ '^[0-9]+$'
        and (metadata->>'completionTokens') ~ '^[0-9]+$'
        then -ceil((metadata->>'promptTokens')::numeric * 0.1 +
                   (metadata->>'completionTokens')::numeric * 0.5)::integer
      else delta * 100
    end as new_delta
  from credit_ledger
), changed as (
  update credit_ledger l set delta = a.new_delta,
    metadata = l.metadata || jsonb_build_object('legacyCredits', a.old_delta, 'accountingVersion', 2)
      || case when l.metadata->>'reservation' = 'true'
        then jsonb_build_object('estimate', a.new_delta * -1) else '{}'::jsonb end
  from amounts a where a.id = l.id
  returning a.user_id, a.new_delta - a.old_delta * 100 as adjustment
), adjustments as (
  select user_id, sum(adjustment) as amount from changed group by user_id
)
update users u set credits_balance = u.credits_balance + a.amount
from adjustments a where u.auth_user_id = a.user_id;

update segments set token_usage = token_usage || jsonb_build_object(
  'creditsCharged', case
    when token_usage->>'creditsCharged' = '0' then 0
    when token_usage->>'modelId' like 'openai/gpt-6-luna%'
      and (token_usage->>'promptTokens') ~ '^[0-9]+$'
      and (token_usage->>'completionTokens') ~ '^[0-9]+$'
      then ceil((token_usage->>'promptTokens')::numeric * 0.1 +
                (token_usage->>'completionTokens')::numeric * 0.5)
    else (token_usage->>'creditsCharged')::numeric * 100
  end,
  'accountingVersion', 2
) where (token_usage->>'creditsCharged') ~ '^[0-9]+$';

comment on column users.credits_balance is 'Integer microdollars; 100 units = 1 displayed Credit';
comment on column credit_ledger.delta is 'Signed integer microdollars; 100 units = 1 displayed Credit';
comment on column credit_purchases.credits is 'Snapshot grant in integer microdollars';

-- Luna is the translation baseline for the credit examples. Explicit env and
-- BYOK model overrides retain their usual precedence.
update models set is_default = false, updated_at = now() where task = 'translate';
insert into models (task, provider, provider_model_id, display_name, is_default)
values ('translate', 'openrouter', 'openai/gpt-6-luna', 'GPT-6 Luna', true)
on conflict (task, provider, provider_model_id) do update
  set is_default = true, display_name = excluded.display_name, updated_at = now();
