-- Credit order lifecycle after 0009: checkout traceability and refund/dispute
-- reversal state. A paid order always has both its payment id and fulfillment
-- time; a reversal records which refund or dispute took the credits back.
alter table credit_purchases add column if not exists checkout_session_id text;
alter table credit_purchases add column if not exists checkout_failed_at timestamptz;
alter table credit_purchases add column if not exists reversed_at timestamptz;
alter table credit_purchases add column if not exists reversal_id text;
alter table credit_purchases add column if not exists reversal_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.credit_purchases'::regclass and conname = 'credit_purchases_fulfillment_check') then
    alter table public.credit_purchases add constraint credit_purchases_fulfillment_check
      check ((payment_id is null) = (fulfilled_at is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.credit_purchases'::regclass and conname = 'credit_purchases_reversal_reason_check') then
    alter table public.credit_purchases add constraint credit_purchases_reversal_reason_check
      check (reversal_reason in ('refund', 'dispute'));
  end if;
  -- All-or-nothing reversal state, only on a fulfilled order. Plain null tests
  -- keep the check from passing on an unknown (null) result.
  if not exists (select 1 from pg_constraint where conrelid = 'public.credit_purchases'::regclass and conname = 'credit_purchases_reversal_check') then
    alter table public.credit_purchases add constraint credit_purchases_reversal_check
      check (
        (reversed_at is null) = (reversal_id is null)
        and (reversed_at is null) = (reversal_reason is null)
        and (reversed_at is null or fulfilled_at is not null)
      );
  end if;
end$$;
