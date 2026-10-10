# BACKEND.md

> Domain terms below are defined in [../CONTEXT.md](../CONTEXT.md). The HTTP routes are documented in [API.md](./API.md); the database in [DATABASE.md](./DATABASE.md).

## Shape

- **Hono** app in [`api/app.ts`](../api/app.ts). Exposed to Cloudflare Workers through [`functions/api/[[route]].ts`](../functions/api/[[route]].ts), which is a one-line re-export.
- All server-only helpers live in [`api/_lib/`](../api/_lib). The `_lib` prefix is a hard signal that nothing in the SPA may import from here.
- TypeScript-only. No build step beyond Wrangler's bundler; `pnpm build` runs `tsc --noEmit && vite build`, which type-checks server code as a side effect.

## Module map (`api/_lib/`)

| Module                 | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`              | Better Auth. `createAuth(env, deps)`: email + password with required verification, Google, 30-day sliding sessions, Postgres-backed rate limits. `withAuth(c, fn)`: a per-request instance with its own `pg.Pool`, closed via `waitUntil` after deferred work. `auth()`: the route guard, which resolves the session cookie, sets `userId`/`email` on context, and forwards refreshed cookies. See [SECURITY.md](./SECURITY.md#authentication).                                               |
| `db.ts`                | `databaseUrl(env)` (Hyperdrive connection string, else `DATABASE_URL`) feeds `createDbClient(env)` → `pg.Client` and the auth `Pool`. `withDb(env, fn)` opens, runs, and always closes a client.                                                                                                                                                                                                                                                                                              |
| `env.ts`               | Typed bindings (`BETTER_AUTH_SECRET`, Google OAuth client, Hyperdrive, ElevenLabs voice IDs, Dodo, Resend, OpenRouter) and Hono `Variables` (`userId`, `email`).                                                                                                                                                                                                                                                                                                                              |
| `schemas.ts`           | All Zod request schemas + the canonical `VIBE_STOPS` list + the `Persona` schema. **Single source of truth for the 6-stop vibe enum on the server.**                                                                                                                                                                                                                                                                                                                                          |
| `validation.ts`        | `parseJson(schema, value)` — manual fallback when `zValidator` middleware isn't a fit.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `errors.ts`            | `formatError(unknown)` — uniform JSON error envelope; converts `HTTPException`, `ZodError`, `Error`, and unknowns.                                                                                                                                                                                                                                                                                                                                                                            |
| `permissions.ts`       | `assertUserOwnsResource`, `canUseFeature` — small guard helpers.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tier.ts`              | `tierLimits` for `free` / `pro` / `team` and the `Tier` type. Tier carries the monthly **Credits** allowance and feature flags.                                                                                                                                                                                                                                                                                                                                                               |
| `models.ts`            | Reads the active default model per task (`translate`, `explain`, `dictation`, `embed`) from the `models` table. Operators flip defaults with SQL — no deploy.                                                                                                                                                                                                                                                                                                                                 |
| `credits.ts`           | Token-derived credit accounting: `estimateCredits`/`computeCredits`, the `reserveCredits` → `reconcileSpend`/`refundReservation` spend flow (atomic pre-call hold, settled to the real cost), `recordGrant`, `getBalance`. Transactional writes keep `users.credits_balance` in sync with `credit_ledger`.                                                                                                                                                                                    |
| `secrets.ts`           | AES-GCM `encryptSecret` / `decryptSecret` for at-rest BYOK keys, using `CREDENTIALS_ENCRYPTION_KEY`. Storage format: `base64(iv):base64(cipher)`.                                                                                                                                                                                                                                                                                                                                             |
| `activity.ts`          | `logActivity(db, userId, action, metadata?)` — write to `activity_log`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `recurrence.ts`        | `getRetentionWindow(retentionDays)` — date math for retention queries (driven by tier).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ai.ts`                | Translation + dictation provider functions. `translateSegment(input, config)` → `{ targetText, tokenAlignment, tokenUsage }` (with `finalizeTokens` enforcing the alignment-reconstruction invariant); `draftCharacterFromDictation(prompt, config)` → `{ draft, tokenUsage? }` (`ok: false` signals fall-back-to-form). Prompt construction lives in `prompts.ts`; the OpenRouter call + strict-JSON parsing go through `openrouter.ts → chatJson`.                                          |
| `openrouter.ts`        | OpenRouter access via the OpenAI SDK. `chatJson({ apiKey, model, messages, schema, schemaName, ... })` enforces a strict `json_schema` response (Zod-validated, one corrective retry) → `{ data, tokenUsage }`. `resolveCallTarget(db, env, userId, task)` picks the BYOK-or-platform key + model (dictation is always platform; decrypt failure falls back to platform).                                                                                                                     |
| `prompts.ts`           | Pure, network-free prompt builders: `buildTranslateMessages`, `buildExplainMessages`, `buildDictationMessages`, `formatPersona`, `targetLanguageGuidance`, `isJapaneseTarget`. The `VIBE_REGISTER` map is the model-facing register guidance. `TRANSLATE_PROMPT_REVISION` versions the canonical prompt and is part of the cache fingerprint — bump it when that prompt changes. Unit-tested in isolation; `app/lib/__tests__/system-prompt-parity.test.ts` keeps the client preview in step. |
| `users.ts`             | `getOrCreateUser(db, userId, email)`: idempotent provisioning of the app-side `users` row (keyed by `auth_user_id`; `email` synchronized only when a non-null session email differs) plus a one-time signup credit grant. `toMeResponse(user)` shapes `/api/users/me`.                                                                                                                                                                                                                        |
| `embeddings.ts`        | `embedText({ text, apiKey, model? })` → `{ modelId, vector, promptTokens }` (via OpenRouter, `openai/text-embedding-3-small`, using the platform key). Owns the embedding model + dimension (`EMBEDDING_DIMENSIONS = 1536`). Also `sha256Hex(text)` for the Explain dedupe key/fingerprints, and `formatVector`/`parseVector` for the pgvector text format.                                                                                                                                   |
| `workspace.ts`         | Character/Thread/Segment column lists, row types and camelCase mappers. `toSegmentPage` and `loadSegmentPage` own the bounded Segment page (50 rows, one lookahead row, `(created_at, id)` microsecond cursor). `loadBootstrap` (roster + preferred-or-first Character) and `loadWorkspace` (one owned Character, no fallback) share the Thread/head-page CTEs and each run as one owner-scoped statement.                                                                                    |
| `translation-cache.ts` | Shared canonical translation cache: `isCanonical`, `fingerprint`, `lookupCache`, `upsertCache`. Cache hits cost 0 credits. See [adr/0004](./adr/0004-shared-canonical-translation-cache.md).                                                                                                                                                                                                                                                                                                  |
| `explain.ts`           | `generateExplain(input, config)` → `{ version, body, tokenUsage }`. Language-aware: a full Japanese body (romaji/morphemes/kanji/grammar) when the target is `ja`, a lighter generic body otherwise. Exports `EXPLAIN_PAYLOAD_VERSION`; bumping invalidates older `explains` rows.                                                                                                                                                                                                            |
| `payments.ts`          | Dodo Payments. `verifyDodoSignature` (Standard Webhooks, raw-body HMAC-SHA256) + `processDodoWebhook` (idempotent, transactional tier/credit application via `webhook_events`). Credit top-ups: the cached `creditPacks` catalog, `createCreditCheckout` (snapshots the order first), fulfillment, and reversal on a full refund or lost/accepted dispute. The `app.ts` webhook route delegates here.                                                                                         |
| `email.ts`             | Transactional email via Resend (raw `fetch`). `sendTransactionalEmail({ env, to, subject, html, text? })` no-ops + warns if `RESEND_API_KEY` is unset. Templates: `verifyEmailContent(url)` / `resetPasswordContent(url)` (auth links) and `subscriptionConfirmationEmail({ plan })`. Sender from `RESEND_FROM`.                                                                                                                                                                              |

## Boundaries

- **The SPA never imports from `api/_lib/`.** Browser code talks to the worker via `app/lib/api.ts`.
- **The worker never imports from `app/`.** No shared types across the boundary — frontend types in `app/lib/types.ts` are defined independently from Zod inferences in `api/_lib/schemas.ts` (they should agree, but agreement is enforced by tests + reviews, not by a generator).
- **Request body validation must use Zod** at every authenticated mutation route. Use the existing `@hono/zod-validator` middleware. Don't reach for `c.req.json()` without a schema.

## Authentication and user provisioning

- **Better Auth**, self-hosted in this worker, is the identity provider ([adr/0008](./adr/0008-better-auth-replaces-clerk.md)). The details are in [SECURITY.md](./SECURITY.md#authentication).
  - Backend: `app.on(['GET', 'POST'], '/api/auth/*')` hands the request to Better Auth's handler (sign-up/in, verification, reset, Google callback, session). The existing `app.use('/api/…', auth())` lines guard everything else.
  - Frontend: `better-auth/react`'s `createAuthClient()` in `app/lib/auth-client.ts`. There is no provider component and no token plumbing.
- The only accepted credential is the session cookie (httpOnly, same origin). `auth()` returns `401` when there's no valid session. Sessions slide over 30 days, and a 5-minute signed cookie cache skips the DB read on most requests.
- **Per request.** `withAuth` builds a Better Auth instance with its own `pg.Pool` (Workers can't reuse sockets across requests, and bindings exist only per request) and closes the pool via `waitUntil` once deferred work settles. Auth emails are deferred the same way, so response latency can't reveal whether an account exists.
- App-data handlers and billing checkout **read or provision** the user into the app-side `users` table via `users.ts → getOrCreateUser`, keyed by `auth_user_id` = the Better Auth user id. `auth()` only sets context vars; cancel, switch-plan, and export do not provision profiles. The first insert atomically grants the free-tier signup balance and ledger entry; existing-user requests, and requests that lost the first-insert race, update `email` only when a non-null session value differs. The row carries `tier`, `subscription_id`, `onboarding_complete`, `locale`, credits and BYOK. Identity (email, password hash, Google link, sessions) stays in the `auth_*` tables.

## Authorization

- **Per-user scoping** is the primary axis. Every row in `characters`, `threads`, `segments`, `activity_log` carries `user_id = users.auth_user_id` (the Better Auth user id). All read and write queries must filter by it. `assertUserOwnsResource(row.user_id, c.get('userId'))` is the explicit guard when ownership needs to be checked imperatively (e.g. after a single-row lookup).
- **Tier gates** use `canUseFeature(tierLimits[user.tier].aiDictation)` etc. The characters-per-user cap is enforced in `POST /api/characters`: the account row is locked (`for update`) before counting, so concurrent creates cannot both slip under it, and a full account gets `403`. `threadsPerCharacter` is defined but not enforced yet. Spending is gated by credits, not a per-month segment count ([adr/0003](./adr/0003-credits-byok-and-model-registry.md)).

## Tiers

Defined in [`api/_lib/tier.ts`](../api/_lib/tier.ts):

|                       | `free` | `pro`  | `team`  |
| --------------------- | ------ | ------ | ------- |
| `characters`          | 3      | 100    | 1000    |
| `threadsPerCharacter` | 20     | 200    | 2000    |
| `credits` (monthly)   | 1 000  | 25 000 | 250 000 |
| `retentionDays`       | 30     | 365    | 1095    |
| `aiDictation`         | ❌     | ✅     | ✅      |
| `explain`             | ❌     | ✅     | ✅      |
| `translationMemory`   | ❌     | ✅     | ✅      |
| `customVibeStops`     | ❌     | ❌     | ✅      |
| `elevenLabsTts`       | ❌     | ✅     | ✅      |

Notes:

- All three tiers use the **same models** (see [DATABASE.md → models](./DATABASE.md#models)). Upgrades buy capacity and features, not output quality.
- `customVibeStops` is the team-tier extension hinted at in the pricing prototype ("6 + custom registers"). Free and Pro are pinned to the canonical six.
- `elevenLabsTts` gates the per-vibe ElevenLabs voices on `/api/ai/text-to-speech` (Japanese targets only today). The free tier — and every non-Japanese target — reads back with the browser's speech synthesis on the client, which never reaches the worker.
- `explain` and `translationMemory` are the persistent-corpus features. Free tier still creates Segments and sees alignment hover, but the Explain button surfaces an upsell and `/api/memory` returns `403`.
- **BYOK users bypass `credits` entirely.** A free-tier user with a stored OpenRouter key can translate as much as they want.

## Integrations

| Integration               | Purpose                                              | Notes                                                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Better Auth**           | Auth (self-hosted: sessions, users)                  | `BETTER_AUTH_SECRET` (required); `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` enable Google, redirect URI `<APP_URL>/api/auth/callback/google`. A library in this worker on our Postgres, not a vendor.                                                                         |
| **Cloudflare Hyperdrive** | Postgres connection pool at the edge                 | `HYPERDRIVE.connectionString`; falls back to `DATABASE_URL` in local dev. Query caching is **off** (stale sessions/lists); pooling only.                                                                                                                                     |
| **OpenRouter**            | LLM provider for translation, explain, and dictation | `OPENROUTER_API_KEY`; key/model routing lives in `openrouter.ts → resolveCallTarget`, calls go through `chatJson`.                                                                                                                                                           |
| **ElevenLabs**            | TTS                                                  | One voice ID per **Vibe stop** (`ELEVENLABS_VOICE_<STOP>`); proxied from `/api/ai/text-to-speech`. The `ja` language code triggers `apply_language_text_normalization: true`.                                                                                                |
| **Dodo Payments**         | Subscriptions, credit top-ups                        | `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_PRODUCT_*`. Raw-`fetch` REST (test/live base URL by `APP_ENV`): `/checkouts`, `/products/{id}`, `/subscriptions/{id}` cancel, `/subscriptions/{id}/change-plan`. Signature-verified, idempotent webhooks. All in `payments.ts`. |
| **Resend**                | Transactional email                                  | `RESEND_API_KEY`, `RESEND_FROM` (verified sender). `email.ts`. **Required in production** for auth emails (verification, password reset). The Dodo webhook also sends a best-effort subscription-confirmation email on activation.                                           |

## Error model

- All errors flow through `app.onError → formatError`.
- `HTTPException` propagates its status. `ZodError` becomes `422` with `details: error.flatten()`. Anything else becomes a generic `500` with the message preserved.
- The envelope shape is `{ error: { message, status, details? } }`. The SPA's `app/lib/api.ts` matches on this shape.

## Activity log

Writes go through `activity.ts → logActivity`. Action strings are free-form for now but should be `<noun>.<verb>` (e.g. `character.created`, `segment.retried`, `tier.upgraded`). Metadata is a small jsonb blob — keep it under a few kilobytes.

## Translation request flow

The Segment-create path is **synchronous translate-and-return** plus an embedding write (see ADR 0001 + 0002 + 0003).

```
client POST /api/segments { threadId, sourceText, vibe? }
  └─ resolve Character (default_vibe, temperature, persona, instructions, langs)
  └─ PRE-CHECK 1: in-thread Segment for (thread, source_text, resolved vibe)?  → return it (200, reused: true), 0 credits
  └─ resolve call target (BYOK key + model override → env *_MODEL → registry default)
  └─ PRE-CHECK 2: canonical request? → translation_cache fingerprint lookup
       │   fingerprint is keyed by the RESOLVED model, so a BYOK/override
       │   translation never collides with the platform-default cache entry
       └─ hit → copy target_text + token_alignment + source_embedding into a
                new Segment (201, reused: false), 0 credits, done
  └─ MISS:
       ├─ BYOK → call user key + BYOK model; no credit accounting (user pays OpenRouter)
       └─ platform → credits.reserveCredits(estimate): atomic hold; null → 402
  ├─ ai.translateSegment(...)                    ← one OpenRouter call
  ├─ embeddings.embedText({ text: sourceText })  ← always platform key + platform embed model (best-effort)
  └─ insert segments (server-produced fields + resolved vibe + source_embedding)
  └─ if platform-key path → credits.reconcileSpend(reservation, realCost)  (refunded only if the model call or the insert failed)
  └─ best-effort, never refunds: if canonical AND platform-default → translation-cache.upsertCache(...)  (BYOK output never seeds the shared cache); bump threads.updated_at; activity log
  ← Segment row (201, reused: false)
```

"Commit-to-translate" (the UI fires one call per intended translation, not per slider move — see [DESIGN.md](./DESIGN.md#the-vibe-slider)) plus the two pre-checks means sliding between already-generated stops is instant and free.

The pre-call **reservation** (`reserveCredits`) is an atomic conditional decrement: it is the concurrency gate that stops a near-zero-balance user from fanning out many simultaneous paid calls past a single stale balance read. It is settled by `reconcileSpend` to the real token cost (or `refundReservation` if the call fails), and writes a pending `credit_ledger` row up front so the `balance == sum(ledger)` invariant holds throughout.

**Refund vs. settle ordering.** A hold is refunded only when the model call or the row insert fails. Once the Segment (or Explain) row is stored the hold is reconciled, and nothing afterwards refunds — a flaky post-commit write would otherwise hand out a free translation that in-thread dedupe then serves at 0 credits. Post-commit steps go through `bestEffort()` in `app.ts`. A refund that itself fails is logged with the ledger id and rethrown, never swallowed. Retry overwrites the row owner-scoped (`where id and user_id`) in the same statement that drops stale Explains; zero rows → refund + `404`.

## Explain request flow

```
client GET /api/segments/:segmentId/explain
  └─ worker looks up explains by (segment_id, version)
       └─ miss? look up by (user_id, target_language, target_text_hash, version)
       └─ miss? explain.generateExplain(...)    ← OpenRouter, one model call
            └─ insert into explains
  ← { segmentId, version, body, cached }
```

- The client never supplies `targetText` or `tokenAlignment` on create.
- The credit reservation runs _before_ the provider call, so a request the balance cannot cover never burns tokens.
- Provider timeout → `504`. Malformed model output (alignment parse failure) → `502`. Insufficient credits → `402`.
- Streaming is intentionally deferred — the structured output (`targetText` + `tokenAlignment` + Explain hooks) doesn't streaming-render cleanly, and the latency budget (~1–4s) fits a spinner. Revisit when load data warrants it.

## Open questions

- ~~Do we keep prompts inline in `ai.ts`, or factor them out?~~ **Resolved:** prompt construction lives in a single pure `prompts.ts` (`buildTranslateMessages` / `buildExplainMessages` / `buildDictationMessages`), unit-tested without network; `ai.ts`/`explain.ts` own the OpenRouter call via `openrouter.ts → chatJson`.
- ~~Should `payments.ts` validate Dodo webhook signatures before the body parser runs?~~ **Resolved:** yes — verify on the raw body _before_ `JSON.parse`, fail `400` with no state mutation, then dedupe via `webhook_events` inside the same transaction as the tier/credit grant. See [adr/0005](./adr/0005-commerce-checkout-and-webhook-idempotency.md) and [SECURITY.md](./SECURITY.md#webhook-signatures).

## Performance reads

`getOrCreateUser` reads existing accounts without changing `updated_at`; only a changed non-null authenticated email is synchronized, which adds one `UPDATE`. First-use provisioning inserts the user balance and signup ledger in one atomic SQL statement, with conflict handling for concurrent first requests. There is no module-level current-user cache. For an existing user with an unchanged email, `/api/app/bootstrap` and `/api/app/workspace` each perform one account lookup and one scoped CTE snapshot (`workspace.ts`). The workspace response omits `me` and the roster for first visits to an already-listed Character. `/api/segments/page` bounds history reads to 51 rows with a timestamp/UUID cursor, and all three routes build pages through the same `toSegmentPage`. See [PERFORMANCE.md](./PERFORMANCE.md) and migration `0008_segment_pagination.sql`.
