-- Snapshot the purchased credit amount before checkout. Fulfillment locks the
-- order and grants once, independently of webhook delivery ids.
create table if not exists credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (auth_user_id) on delete cascade,
  product_id text not null,
  quantity integer not null check (quantity between 1 and 10),
  credits integer not null check (credits > 0),
  payment_id text unique,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index if not exists credit_purchases_user_created_idx
  on credit_purchases (user_id, created_at desc);
