# SECURITY.md

> Cross-references: auth + boundaries in [BACKEND.md](./BACKEND.md), data scoping in [DATABASE.md](./DATABASE.md), edge controls in [CLOUDFLARE.md](./CLOUDFLARE.md).

## Authentication

- **Clerk** is the identity provider. The worker accepts a `Authorization: Bearer <token>` or the `__session` cookie, verified via `@clerk/backend → authenticateRequest` in `api/_lib/auth.ts`.
- Unauthenticated requests to guarded routes get `401`. The middleware also upserts the user into `users` on first authenticated call.
- Missing Clerk config (`CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY`) fails closed with `500`, never open.

## Authorization & data scoping {#per-user-scoping}

- **Every per-user table** (`characters`, `threads`, `segments`, `explains`, `credit_ledger`, `activity_log`) is scoped by `user_id = clerk_user_id`. All reads and writes must filter on it.
- `assertUserOwnsResource(row.user_id, c.get('userId'))` is the explicit guard after any single-row fetch before mutate/return. On a mismatch it raises **404** (not 403), so the API never reveals that a resource id exists but belongs to another user — matching the scoped `where id = $1 and user_id = $2` deletes/updates.
- Cascade deletes flow user → character → thread → segment → explain. Deleting a user removes all owned data and embeddings.
- Tier feature gates (`explain`, `translationMemory`, `aiDictation`, `customVibeStops`) are enforced server-side via `canUseFeature`; the client UI gate is cosmetic only.

## The unauthenticated surface

Only these routes are intentionally public:

| route | why public | protection |
| --- | --- | --- |
| `GET /api/health` | uptime checks | none needed (no data, no cost) |
| `GET /api/diagnostics` | DB connectivity check | no user data; returns only `now()` |
| `POST /api/waitlist` | pre-auth signups | edge rate limit + unique-email constraint |

**`GET /api/share/:token` is public by design.** A share link is a capability: the token is 24 random bytes (base64url, ~144 bits), minted only by the Thread's owner via `POST /api/threads/:id/share`, and revocable (`revoked_at`). The resolver selects a redacted projection — thread title, character display fields, segment texts/alignment — and never user ids, token usage, or credits. Tokens are validated against `^[A-Za-z0-9_-]{16,64}$` before touching the DB; unknown/revoked/archived → uniform `404`. Responses are `no-store`.

**`POST /api/ai/text-to-speech` is authenticated and tier-gated (Pro+).** The free tier reads back with the browser's speech synthesis, which never touches the worker. It proxies to ElevenLabs, which bills per character — leaving it open is a direct cost-abuse vector. The landing-page demo therefore does **not** call it; it plays pre-rendered per-vibe MP3s from `public/demo/` (fixed translations, no editable source). See [public/demo/README.md](../public/demo/README.md).

## Abuse protection & rate limiting

Two layers (see [adr/0003](./adr/0003-credits-byok-and-model-registry.md) and CLOUDFLARE.md):

1. **Edge (coarse).** Cloudflare Rate Limiting Rules / WAF on `/api/*`, per-IP. Runs before the worker, so abusive traffic never reaches metered providers. This is the first line for the public routes and for burst protection everywhere.
2. **Application (fine).** The **credits** system is the per-user cost control on the expensive model paths (translate, explain, dictation). Each paid call takes an **atomic credit reservation** (`reserveCredits`, a conditional `credits_balance >= estimate` decrement) *before* the model call, reconciled to the real cost afterwards. A request that can't cover the hold returns `402`. Because the reservation row-locks, concurrent requests serialize — a near-zero-balance user can't fan out many simultaneous paid calls past a single stale balance read. We deliberately do **not** maintain a bespoke KV/Durable-Object limiter unless edge rules prove insufficient.

Onboarding dictation is free and costs tokens, so it's bounded three ways: only callable while `onboarding_complete = false`, a lifetime call counter in `activity_log`, and the edge rate limit.

## BYOK key handling

- BYOK OpenRouter keys are **encrypted at rest** with AES-GCM (`api/_lib/secrets.ts`), using `CREDENTIALS_ENCRYPTION_KEY` (32-byte base64). Storage format `base64(iv):base64(cipher)` with a per-record random 96-bit IV.
- The plaintext key is accepted only over TLS on `PUT /api/users/me/byok` and **never returned** in any response — `GET /api/users/me` exposes only `last4`.
- **Key rotation:** rotating `CREDENTIALS_ENCRYPTION_KEY` requires decrypting every stored cipher with the old key and re-encrypting with the new one (a migration job). There is no dual-key grace window today — plan rotation as a maintenance task.
- If decryption fails (e.g. post-rotation gap), the request **falls back to the platform key path** rather than `500`-ing — degrade, don't break.
- Embeddings never use BYOK; the platform key owns them so corpus vectors stay comparable.

## Webhook signatures {#webhook-signatures}

- `POST /api/billing/webhooks/dodo` is unauthenticated by design (Dodo calls it) and is therefore **exempted from the Clerk `auth()` middleware** — only `/checkout`, `/cancel`, and `/switch-plan` under `/api/billing/*` are authenticated.
- It **verifies the Dodo signature** using `DODO_WEBHOOK_SECRET` before trusting the body. Dodo follows the [Standard Webhooks](https://www.standardwebhooks.com/) spec: `verifyDodoSignature` in `api/_lib/payments.ts` runs on the **raw body before any JSON parsing**, computing `HMAC-SHA256` over `${webhook-id}.${webhook-timestamp}.${rawBody}` with the base64-decoded secret and comparing (constant-time) against each `v1,<sig>` entry in the `webhook-signature` header.
- If signature verification fails, the route returns `400` and **does not parse or mutate state**. A missing `DODO_WEBHOOK_SECRET` fails closed with `500`.
- **Replay protection** is twofold: the timestamp must be within a ±5-minute window, and every accepted event is recorded in `webhook_events` (keyed by `webhook-id`). The dedupe insert and the tier/credit mutation share **one transaction**, so redelivered events are a no-op and a mid-flight failure rolls back cleanly for the provider's retry.

## Input validation

- Every mutation route validates its body with a **Zod** schema (`api/_lib/schemas.ts`) via `@hono/zod-validator`. No handler calls `c.req.json()` without a schema. The Dodo webhook is the one deliberate exception: it reads the **raw** body with `c.req.text()` and verifies the signature *before* `JSON.parse`, so a Zod middleware (which would parse first) cannot front it.
- Locale fields are constrained to BCP-47 shape; BYOK model IDs to `provider/model` shape; the OpenRouter key to the `sk-` prefix.
- Validation failures return `422` with `error.flatten()` details; they never reach the database.
- **Upstream provider errors** (OpenRouter, Dodo, ElevenLabs, embeddings) are logged server-side; client responses carry only a generic message + HTTP status, never the raw provider response body, so provider/model internals and request ids aren't leaked. The one exception is a `401/403` from OpenRouter, surfaced as "check your OpenRouter key" so BYOK users can self-diagnose.

## Data retention & deletion

- **Soft limit:** per-tier `retentionDays` (`30 / 365 / 1095`) defines how long history is kept. Enforcement (a scheduled prune using `getRetentionWindow`) is **not yet wired** — tracked as an open item.
- **Hard control:** `DELETE /api/segments/:id` cascades the embedding + `explains`; user deletion cascades everything. `GET /api/export` lets a user pull all their data.
- Translation memory means user content (their messages, in their target language) is stored long-term — treat `segments.source_text` / `target_text` and `explains.body` as user PII.

## Transport & CORS

- CORS allows the configured `APP_URL` origin only, with credentials and `authorization` + `content-type` headers (`api/app.ts`).
- Service worker (`public/sw.js`) never caches `/api/*` — auth'd responses must not be served from cache.

## Open items (launch blockers marked ⚠)

- ✅ Dodo webhook signature verification — wired in `api/_lib/payments.ts` (`verifyDodoSignature`), with `webhook_events` dedupe + a ±5-min replay window. See [adr/0005](./adr/0005-commerce-checkout-and-webhook-idempotency.md).
- ⚠ `CREDENTIALS_ENCRYPTION_KEY` provisioned in every deployed environment before BYOK ships.
- Retention prune job (scheduled worker / cron).
- BYOK key rotation runbook + optional dual-key grace window.
- Decide whether `/api/diagnostics` should be authenticated in production (it reveals DB reachability).
