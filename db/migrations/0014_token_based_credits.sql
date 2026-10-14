-- Drain old worker requests before applying. All stored amounts become whole
-- Credits: round((promptTokens + completionTokens) / 10), minimum one per call.
-- Convert dollar-backed grants/top-ups at 700,000 Credits per dollar, calibrated
-- from the supplied Luna usage sample. This is an approximate cost budget.
create temporary table credit_conversion_balances on commit drop as
select u.auth_user_id,
       u.credits_balance - coalesce(sum(l.delta), 0) as unledgered_units
from users u left join credit_ledger l on l.user_id = u.auth_user_id
group by u.auth_user_id, u.credits_balance;

update credit_ledger set
  delta = case
    when reason = 'grant.signup' and delta > 0 then 50000
    when reason like 'spend.%' and delta <> 0
      and metadata->>'reservation' is distinct from 'true'
      and (metadata->>'promptTokens') ~ '^[0-9]+$'
      and (metadata->>'completionTokens') ~ '^[0-9]+$'
      then -greatest(1, round(((metadata->>'promptTokens')::numeric +
                              (metadata->>'completionTokens')::numeric) / 10))::integer
    else round(delta::numeric * 0.7)::integer
  end,
  metadata = metadata || jsonb_build_object('previousAccountingUnits', delta, 'accountingVersion', 3)
    || case when metadata->>'reservation' = 'true'
      then jsonb_build_object('estimate', round(-delta::numeric * 0.7)::integer)
      else '{}'::jsonb end;

update users u set credits_balance = (
  select coalesce(sum(delta), 0) from credit_ledger where user_id = u.auth_user_id
) + round(b.unledgered_units * 0.7)::integer
from credit_conversion_balances b where b.auth_user_id = u.auth_user_id;

-- Keep each order's converted grant as the refund/dispute snapshot, including
-- unfulfilled orders. Future orders snapshot the new larger catalog amounts.
update credit_purchases set credits = greatest(1, round(credits::numeric * 0.7))::integer;

update segments set token_usage = token_usage || jsonb_build_object(
  'creditsCharged', case
    when token_usage->>'creditsCharged' = '0' then 0
    when (token_usage->>'promptTokens') ~ '^[0-9]+$'
      and (token_usage->>'completionTokens') ~ '^[0-9]+$'
      then greatest(1, round(((token_usage->>'promptTokens')::numeric +
                             (token_usage->>'completionTokens')::numeric) / 10))
    else round((token_usage->>'creditsCharged')::numeric * 0.7)
  end,
  'accountingVersion', 3
) where (token_usage->>'creditsCharged') ~ '^[0-9]+$';

comment on column users.credits_balance is 'Whole Credits; ten model tokens per Credit, rounded per request';
comment on column credit_ledger.delta is 'Signed whole Credits';
comment on column credit_purchases.credits is 'Snapshot grant in whole Credits';
