-- Commerce layer: Dodo Payments webhook idempotency + subscription lookup.
-- Adds the webhook_events dedupe ledger (keyed by Dodo's Standard-Webhooks
-- `webhook-id`) so redelivered events are a no-op, and a unique index on
-- users.subscription_id so renewal/cancel events can resolve the user when
-- checkout metadata is absent. See docs/adr/0005, docs/SECURITY.md#webhook-signatures.
-- Mirrors db/schema.sql. Idempotent (create … if not exists).

-- Append-only record of every webhook we have already processed. The webhook
-- handler inserts a row inside the same transaction as the tier/credit
-- mutation, so a redelivery (same event_id) is dropped before any grant runs.
create table if not exists webhook_events (
  event_id text primary key,                               -- provider's event id (Dodo `webhook-id` header)
  source text not null default 'dodo',
  event_type text,
  received_at timestamptz not null default now()
);

-- Lifecycle events (renewed/cancelled/expired) may not carry checkout
-- metadata; resolve the owning user by their stored Dodo subscription id.
create unique index if not exists users_subscription_id_uniq
  on users (subscription_id) where subscription_id is not null;
