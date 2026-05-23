---
status: accepted
---

# Commerce: Dodo checkout identity, webhook verification & idempotency

The commerce layer (Dodo Payments checkout + subscription webhooks) needs three decisions nailed down: how a webhook maps an event back to a local user, when signature verification runs, and how redelivered webhooks avoid double-applying credits. These are load-bearing for correctness and security, and one of them (signature verification) is a launch blocker.

## Identity flows through checkout metadata, not email

`createCheckoutSession` stamps `metadata: { clerk_user_id, plan }` onto the Dodo checkout. The webhook resolves the local user from `event.data.metadata.clerk_user_id`. For lifecycle events that may omit metadata (renewed / cancelled / expired), it falls back to looking the user up by the stored `subscription_id` — which is why `users.subscription_id` gets a partial-unique index.

We **rejected matching by customer email**. The Clerk identity email and the Dodo billing email can legitimately differ (a user pays with a work address, signs in with a personal one), and a silent mismatch would either upgrade the wrong account or drop the event. `clerk_user_id` is the same key every per-user table already scopes on, so it is the natural join.

## Signature verification runs on the raw body, before parsing

Dodo follows the [Standard Webhooks](https://www.standardwebhooks.com/) spec. `verifyDodoSignature` (in `api/_lib/payments.ts`) computes `HMAC-SHA256` over `${webhook-id}.${webhook-timestamp}.${rawBody}` using the base64-decoded `DODO_WEBHOOK_SECRET`, and constant-time-compares the result against each `v1,<sig>` entry in the `webhook-signature` header. It also rejects timestamps outside a ±5-minute window (replay guard).

Verification happens on the **raw** request body (`c.req.text()`) **before** `JSON.parse` and before any DB work. A failed verification returns `400` and mutates nothing; a missing secret fails closed with `500`. This is the one route deliberately exempt from both the Clerk `auth()` middleware (Dodo can't present a session) and the Zod body-validation convention (a parser-first middleware can't sit in front of a raw-body verifier).

## Idempotency: a dedupe table, applied in the same transaction as the grant

There is **no monthly credit refill scheduler yet**, so an upgrade that only set `tier` would leave the subscriber with their old (free-tier) balance. Therefore the webhook **grants the new tier's credit allowance** on activation/renewal — and credit grants are not naturally idempotent, so a redelivered webhook would double-grant.

We add a `webhook_events` table keyed by Dodo's `webhook-id`. `processDodoWebhook` opens one transaction, `insert … on conflict (event_id) do nothing`, and:

- if the row already existed (`rowCount === 0`) → commit and return `deduped`, applying nothing;
- otherwise → apply the tier change + credit grant **inside the same transaction**, then commit.

Because the dedupe insert and the mutation share a transaction, a redelivery is a guaranteed no-op and a mid-flight crash rolls back the dedupe row so the provider's retry is processed cleanly.

The grant is written **inline** (an additive `credit_ledger` row plus a `users.credits_balance` update) rather than via `credits.recordGrant`, because `recordGrant` opens its own transaction and Postgres has no nested transactions. The inline accounting mirrors `recordGrant` exactly and preserves the `sum(credit_ledger.delta) = users.credits_balance` invariant. Activation grants are recorded as `grant.subscription`; renewals reuse `grant.monthly` and refresh `credits_refilled_at`.

The grant first runs `insert into users (clerk_user_id) values ($1) on conflict do nothing` so the `credit_ledger` foreign key always resolves. A user can reach checkout — and therefore this webhook — before any authenticated DB route has lazily created their local row via `getOrCreateUser`; without the guard the ledger insert would raise a foreign-key violation, roll back the whole transaction (including the `webhook_events` dedupe row), and leave the provider retrying a paid event forever. We do **not** call `getOrCreateUser` here because it opens its own transaction (via `recordGrant`); the bare insert adds no signup grant, which `getOrCreateUser` remains the sole owner of.

## Lifecycle teardown: transient failure vs. terminal end

A failed charge (`subscription.failed`) is often transient — Dodo retries via dunning. So it downgrades the user to `free` but **keeps `subscription_id`**, so a later recovery event that omits checkout metadata can still resolve the user by subscription id. Only the terminal events (`subscription.cancelled` / `subscription.expired`) clear `subscription_id`. Neither claws back unused credits.

The one-time **confirmation email** is sent only on first activation (`subscription.active`), not on renewals or plan changes — `plan_changed` would otherwise re-send an "activated" email on every upgrade/downgrade.

## Consequences

- New table `webhook_events` and a partial-unique index on `users.subscription_id` (migration `0002_commerce.sql`).
- `LedgerReason` gains `grant.subscription`.
- Upgrades stack the new allowance on top of any remaining balance (additive, ledger-consistent). When a real monthly refill scheduler lands, it should reconcile rather than re-grant.
- Terminal cancellation/expiry downgrades `tier` to `free` and clears `subscription_id`; a transient `subscription.failed` downgrades but keeps `subscription_id` for recovery. Neither claws back unused credits.
- The grant ensures the local `users` row exists (`insert … on conflict do nothing`) before the ledger write, so a webhook that arrives before the user's first authenticated request still provisions cleanly.
- `/api/billing/webhooks/dodo` is excluded from `auth()`; only `/checkout`, `/cancel`, `/switch-plan` are authenticated under `/api/billing/*`.
