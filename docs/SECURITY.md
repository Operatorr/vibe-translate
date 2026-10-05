# SECURITY.md

> Cross-references: auth + boundaries in [BACKEND.md](./BACKEND.md), data scoping in [DATABASE.md](./DATABASE.md), edge controls in [CLOUDFLARE.md](./CLOUDFLARE.md).

## Authentication

Self-hosted **Better Auth** ([adr/0008](./adr/0008-better-auth-replaces-clerk.md)) runs in the worker against our Postgres. It is configured in `api/_lib/auth.ts` and mounted at `/api/auth/*`. Identity lives in the `auth_*` tables.

- **Methods.** Email + password (min 8 chars) with **required** email verification, and Google OAuth (`prompt=select_account`, enabled only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set). An unverified account can't sign in: the attempt re-sends the verification link, and opening that link signs the user in. Password reset is by email and **revokes every session**.
- **Session = cookie, not a token.** The session is a same-origin httpOnly cookie, `SameSite=Lax`, and `Secure` with the `__Secure-` prefix on https. JavaScript never sees it, and the API accepts no bearer token. Expiry is 30 days and slides (`expiresIn` 30d, `updateAge` 1d): use after a day extends it, so daily users stay signed in, and 30 idle days expire it.
- **Cookie cache.** A signed session-data cookie (5 min) lets most requests skip the session DB read. The trade-off is that revocation (sign-out on another device, password reset) on other devices can lag by up to 5 minutes. The successful reset response expires this browser’s session and cache cookies immediately, and the client clears its session store.
- **Route guard.** `auth()` resolves the session (cookie cache, else DB) and sets `userId` and `email` on context. No session → `401`. It forwards refreshed `Set-Cookie` headers onto the handler's response. It never touches `users`: handlers call `getOrCreateUser`, which lazily creates the app-side row and grants signup credits.
- **Origin check.** `trustedOrigins = [APP_URL]`. Better Auth rejects requests from any other `Origin` with `403 INVALID_ORIGIN`, and callback/redirect URLs must be on that origin too.
- **Rate limits** are on only when `APP_ENV=production`. Counters live in Postgres (`auth_rate_limits`) because isolate memory doesn't persist across requests. Better Auth's built-in rules apply: sign-in and sign-up are capped at 3 per 10 s, and the email senders (`/send-verification-email`, `/request-password-reset`) at 3/min so they can't flood an inbox. The client IP comes from `cf-connecting-ip`. The edge WAF stays the coarse layer.
- **Account linking.** Google links into an existing account only if that account's email is already verified (explicitly configured `account.accountLinking.requireLocalEmailVerified: true`). This blocks pre-registration takeover: an attacker who signs up with a victim's address can't have the victim's later Google sign-in merge into it. `/auth` explains the resulting `account_not_linked` error.
- **No timing leak.** Auth emails are sent after the response (`waitUntil`), so latency doesn't reveal whether an address has an account.
- **OAuth tokens at rest.** `auth_accounts.access_token`, `refresh_token`, and `id_token` use Better Auth’s default plaintext storage. A database read compromise can expose live Google access and refresh tokens. Restrict database and backup access, never log these columns, and revoke affected grants after a compromise. BYOK encryption does not cover OAuth tokens.
- **Passwords** are hashed with scrypt, using native `node:crypto` in workerd through the `@better-auth/utils` `workerd` export condition. The hash is stored in `auth_accounts.password` (`provider_id = 'credential'`).
- **Fails closed.** A missing `BETTER_AUTH_SECRET` returns `500` on `/api/auth/*` and every guarded route, never open. Missing production `APP_URL` returns `500`, with no localhost fallback. Email-dependent auth POSTs return `503` before dispatch if production `RESEND_API_KEY` is missing. Production also needs `RESEND_FROM` on a Resend-verified domain. Deferred delivery failures are logged; the inbox screen tells users to sign in again to request a fresh verification link. Locally, with no key, the worker logs `[auth] <subject> → <email>: <url>` instead of sending.
- **Sign-out** (`app/lib/auth-client.ts → signOut`) pauses cache persistence, cancels queries and clears memory, deletes the user-scoped IndexedDB cache after pending writes, ends the session, and hard-navigates to `/`, so nothing from one account survives into the next on a shared device.

## Authorization & data scoping {#per-user-scoping}

- **Every per-user table** (`characters`, `threads`, `segments`, `explains`, `credit_ledger`, `activity_log`) is scoped by `user_id = users.auth_user_id`, which is the Better Auth user id (`c.get('userId')`). All reads and writes must filter on it.
- `assertUserOwnsResource(row.user_id, c.get('userId'))` is the explicit guard after any single-row fetch before mutate/return. On a mismatch it raises **404** (not 403), so the API never reveals that a resource id exists but belongs to another user — matching the scoped `where id = $1 and user_id = $2` deletes/updates.
- Cascade deletes flow `auth_users` → `users` → character → thread → segment → explain (plus sessions and linked accounts). Deleting the identity removes all owned data and embeddings.
- Tier feature gates (`explain`, `translationMemory`, `aiDictation`, `customVibeStops`) are enforced server-side via `canUseFeature`; the client UI gate is cosmetic only.

## The unauthenticated surface

Only these routes are intentionally public:

| route                             | why public               | protection                                                             |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `/api/auth/*`                     | sign-up/in, reset, OAuth | Better Auth: origin check, DB rate limits, required email verification |
| `POST /api/billing/webhooks/dodo` | payment notifications    | Standard Webhooks signature, replay window, event deduplication        |
| `GET /api/health`                 | uptime checks            | none needed (no data, no cost)                                         |
| `GET /api/diagnostics`            | DB connectivity check    | no user data; returns only `now()`                                     |
| `POST /api/waitlist`              | pre-auth signups         | edge rate limit + unique-email constraint                              |
| `GET /api/share/:token`           | read-only shared Thread  | unguessable revocable token, redacted projection, `no-store` (below)   |

**`GET /api/share/:token` is public by design.** A share link is a capability: the token is 24 random bytes (base64url, 192 bits of entropy), minted only by the Thread's owner via `POST /api/threads/:id/share`, and revocable (`revoked_at`). The resolver selects a redacted projection — thread title, character display fields, segment texts/alignment — and never user ids, token usage, or credits. Tokens are validated against `^[A-Za-z0-9_-]{16,64}$` before touching the DB; unknown/revoked/archived → uniform `404`. Responses are `no-store`. Every `/api/share/*` response — errors included — also sends `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`; the SPA route `/share/*` gets the same headers from `public/_headers` plus a runtime robots meta tag, `robots.txt` disallows `/share/`, and the client never keeps a resolved share in memory (`staleTime`/`gcTime` 0). A partial unique index on the live `thread_id` guarantees a single live capability per Thread even under concurrent mints; archived threads can't be shared (`409`). The payload is capped at 500 Segments.

**`POST /api/ai/text-to-speech` is authenticated and tier-gated (Pro+).** The free tier reads back with the browser's speech synthesis, which never touches the worker. It proxies to ElevenLabs, which bills per character — leaving it open is a direct cost-abuse vector. The landing-page demo therefore does **not** call it; it plays pre-rendered per-vibe MP3s from `public/demo/` (fixed translations, no editable source). See [public/demo/README.md](../public/demo/README.md).

## Abuse protection & rate limiting

Two layers (see [adr/0003](./adr/0003-credits-byok-and-model-registry.md) and CLOUDFLARE.md):

1. **Edge (coarse).** Cloudflare Rate Limiting Rules / WAF on `/api/*`, per-IP. Runs before the worker, so abusive traffic never reaches metered providers. This is the first line for the public routes and for burst protection everywhere.
2. **Application (fine).** The **credits** system is the per-user cost control on the expensive model paths (translate, explain, dictation). Each paid call takes an **atomic credit reservation** (`reserveCredits`, a conditional `credits_balance >= estimate` decrement) _before_ the model call, reconciled to the real cost afterwards. A request that can't cover the hold returns `402`. Because the reservation row-locks, concurrent requests serialize — a near-zero-balance user can't fan out many simultaneous paid calls past a single stale balance read. We deliberately do **not** maintain a bespoke KV/Durable-Object limiter unless edge rules prove insufficient.

Onboarding dictation is free and costs tokens, so it's bounded three ways: only callable while `onboarding_complete = false`, a lifetime call counter in `activity_log`, and the edge rate limit.

## BYOK key handling

- BYOK OpenRouter keys are **encrypted at rest** with AES-GCM (`api/_lib/secrets.ts`), using `CREDENTIALS_ENCRYPTION_KEY` (32-byte base64). Storage format `base64(iv):base64(cipher)` with a per-record random 96-bit IV.
- The plaintext key is accepted only over TLS on `PUT /api/users/me/byok` and **never returned** in any response — `GET /api/users/me` exposes only `last4`.
- **Key rotation:** rotating `CREDENTIALS_ENCRYPTION_KEY` requires decrypting every stored cipher with the old key and re-encrypting with the new one (a migration job). There is no dual-key grace window today — plan rotation as a maintenance task.
- If decryption fails (e.g. post-rotation gap), the request **falls back to the platform key path** rather than `500`-ing — degrade, don't break.
- Embeddings never use BYOK; the platform key owns them so corpus vectors stay comparable.

## Webhook signatures {#webhook-signatures}

- `POST /api/billing/webhooks/dodo` is unauthenticated by design (Dodo calls it) and is therefore **exempted from the `auth()` session middleware** — only `/checkout`, `/cancel`, and `/switch-plan` under `/api/billing/*` are authenticated.
- It **verifies the Dodo signature** using `DODO_WEBHOOK_SECRET` before trusting the body. Dodo follows the [Standard Webhooks](https://www.standardwebhooks.com/) spec: `verifyDodoSignature` in `api/_lib/payments.ts` runs on the **raw body before any JSON parsing**, computing `HMAC-SHA256` over `${webhook-id}.${webhook-timestamp}.${rawBody}` with the base64-decoded secret and comparing (constant-time) against each `v1,<sig>` entry in the `webhook-signature` header.
- If signature verification fails, the route returns `400` and **does not parse or mutate state**. A missing `DODO_WEBHOOK_SECRET` fails closed with `500`.
- **Replay protection** is twofold: the timestamp must be within a ±5-minute window, and every accepted event is recorded in `webhook_events` (keyed by `webhook-id`). The dedupe insert and the tier/credit mutation share **one transaction**, so redelivered events are a no-op and a mid-flight failure rolls back cleanly for the provider's retry.

## Input validation

- Every mutation route validates its body with a **Zod** schema (`api/_lib/schemas.ts`) via `@hono/zod-validator`. No handler calls `c.req.json()` without a schema. The Dodo webhook is the one deliberate exception: it reads the **raw** body with `c.req.text()` and verifies the signature _before_ `JSON.parse`, so a Zod middleware (which would parse first) cannot front it.
- Locale fields are constrained to BCP-47 shape; BYOK model IDs to `provider/model` shape; the OpenRouter key to the `sk-` prefix.
- Validation failures return `422` with `error.flatten()` details; they never reach the database.
- **Upstream provider errors** (OpenRouter, Dodo, ElevenLabs, embeddings) are logged server-side; client responses carry only a generic message + HTTP status, never the raw provider response body, so provider/model internals and request ids aren't leaked. The one exception is a `401/403` from OpenRouter, surfaced as "check your OpenRouter key" so BYOK users can self-diagnose.

## Data retention & deletion

- **Soft limit:** per-tier `retentionDays` (`30 / 365 / 1095`) defines how long history is kept. Enforcement (a scheduled prune using `getRetentionWindow`) is **not yet wired** — tracked as an open item.
- **Hard control:** `DELETE /api/segments/:id` cascades the embedding + `explains`; user deletion cascades everything. `GET /api/export` lets a user pull all their data.
- Translation memory means user content (their messages, in their target language) is stored long-term — treat `segments.source_text` / `target_text` and `explains.body` as user PII.

## Transport & CORS

- CORS allows the configured `APP_URL` origin only, with credentials and the `content-type` header (`api/app.ts`). There is no `authorization` header, because auth is the session cookie.
- Service worker (`public/sw.js`) never caches `/api/*` — auth'd responses must not be served from cache.

## Open items (launch blockers marked ⚠)

- ✅ Dodo webhook signature verification — wired in `api/_lib/payments.ts` (`verifyDodoSignature`), with `webhook_events` dedupe + a ±5-min replay window. See [adr/0005](./adr/0005-commerce-checkout-and-webhook-idempotency.md).
- ⚠ `CREDENTIALS_ENCRYPTION_KEY` provisioned in every deployed environment before BYOK ships.
- ⚠ `RESEND_API_KEY` + `RESEND_FROM` on a verified domain in production. Without them, email verification (and so password sign-up) can't complete.
- Self-serve account deletion. Better Auth's `deleteUser` isn't enabled, so today deletion is an operator `delete from auth_users where id = …`, which cascades everything.
- Retention prune job (scheduled worker / cron).
- BYOK key rotation runbook + optional dual-key grace window.
- Decide whether `/api/diagnostics` should be authenticated in production (it reveals DB reachability).
