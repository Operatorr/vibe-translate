# API.md

> Domain terms below are defined in [../CONTEXT.md](../CONTEXT.md). The HTTP routes live in [`api/app.ts`](../api/app.ts).

## Shape

- **Hono** app, deployed as a Cloudflare Worker via `functions/api/[[route]].ts`.
- All routes are prefixed `/api/*`. The worker handles `/api/*` before the static asset binding takes over.
- Request bodies are validated with **Zod** schemas from [`api/_lib/schemas.ts`](../api/_lib/schemas.ts). Validation runs as Hono middleware (`@hono/zod-validator`); a failed schema returns `400` with a normalized error from `formatError`.
- Errors are returned as JSON `{ error: { ... } }`. `api/_lib/errors.ts → formatError` converts `HTTPException`, Zod errors, auth errors, and unknown errors into a single envelope shape.
- **No API versioning today.** Breaking changes are coordinated across the SPA and worker since they ship together.

## Auth

- The credential is the **Better Auth session cookie**: httpOnly, same origin, sent automatically (`credentials: 'include'`). There is no bearer token. `api/_lib/auth.ts → auth()` resolves the session (signed cookie cache, else DB), sets `userId` and `email` on Hono context (`c.get('userId')`, etc.), and returns `401` without one. Refreshed session cookies ride back on the handler's response. See [SECURITY.md](./SECURITY.md#authentication).
- `auth()` doesn't touch the DB's `users` table. Handlers call `getOrCreateUser`, which upserts the app-side row on the first authenticated call.
- The CORS layer allows the `APP_URL` origin only, with credentials and the `content-type` header.

| Guarded prefix           | Notes    |
| ------------------------ | -------- |
| `/api/users/*`           | `auth()` |
| `/api/characters/*`      | `auth()` |
| `/api/threads/*`         | `auth()` |
| `/api/segments/*`        | `auth()` |
| `/api/memory`            | `auth()` |
| `/api/activity/*`        | `auth()` |
| `/api/onboarding/*`      | `auth()` |
| `/api/ai/dictation`      | `auth()` |
| `/api/ai/text-to-speech` | `auth()` |
| `/api/billing/*`         | `auth()` |
| `/api/export`            | `auth()` |

Unguarded (intentionally public): **`/api/auth/*`** (Better Auth's own endpoints, which enforce their own origin and rate-limit checks — see [Auth endpoints](#auth-endpoints-better-auth)), `/api/health`, `/api/diagnostics`, `/api/waitlist`, **`/api/share/:token`** (read-only share links; the unguessable token is the capability — see [SECURITY.md](./SECURITY.md#the-unauthenticated-surface)). **`/api/ai/text-to-speech` is authenticated** — it proxies to metered ElevenLabs, so the landing demo uses pre-rendered clips instead (see [SECURITY.md](./SECURITY.md#the-unauthenticated-surface)).

Resource ids in paths (`:characterId`, `:threadId`, `:segmentId`) and the `characterId`/`threadId` query filters are UUIDs; a malformed id returns `404`, never a database `500`.

## Surface

### Auth endpoints (Better Auth) {#auth-endpoints-better-auth}

`app.on(['GET', 'POST'], '/api/auth/*')` passes the raw request to Better Auth's handler (`withAuth(c, (a) => a.handler(c.req.raw))`). These routes are Better Auth's contract, not ours: no Zod schemas, and Better Auth's error shape (`{ code, message }`). The SPA calls them through `authClient` (`app/lib/auth-client.ts`). The ones the app uses:

| endpoint                                | used for                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/sign-up/email`          | create account (`name`, `email`, `password`, `callbackURL`); sends the verification email               |
| `POST /api/auth/sign-in/email`          | password sign-in; `403 EMAIL_NOT_VERIFIED` when unverified, and the verification link is re-sent        |
| `POST /api/auth/sign-in/social`         | start Google OAuth (`provider: 'google'`) → returns the Google redirect URL                             |
| `GET /api/auth/callback/google`         | Google OAuth redirect URI (`<APP_URL>/api/auth/callback/google`); sets the session, redirects to `/app` |
| `GET /api/auth/verify-email`            | the emailed verification link (`?token=`); verifies, signs in, redirects to `/auth` → `/app`            |
| `POST /api/auth/request-password-reset` | send the reset email (answers the same whether or not the address exists)                               |
| `GET /api/auth/reset-password/:token`   | the emailed reset link; redirects to `/auth?token=…`                                                    |
| `POST /api/auth/reset-password`         | set the new password (`newPassword`, `token`); revokes all sessions                                     |
| `GET /api/auth/get-session`             | current session + user, or `null` (`authClient.useSession()`)                                           |
| `POST /api/auth/sign-out`               | end the session and clear its cookies                                                                   |

Failed links and OAuth errors redirect to `/auth?error=<code>` (`onAPIError.errorURL`). In production, requests from an `Origin` other than `APP_URL` get `403 INVALID_ORIGIN`, and the email-sending endpoints are rate-limited to 3/min.

### Health & diagnostics

- `GET /api/health` → `{ ok: true, env }`.
- `GET /api/diagnostics` → connects to Postgres via Hyperdrive and returns `now()`; `503` if the DB is unreachable.

### Users

- `GET /api/users/me` → identity, tier, tier limits, `credits: { balance, refilledAt }`, `byok: { configured, last4, translateModelId, explainModelId }`, onboarding flag. **Never returns the BYOK plaintext key.**
- `PATCH /api/users/me` → `userUpdateSchema` (display name, locale, onboarding flag).
- `PUT /api/users/me/byok` → `byokSetSchema` (`apiKey`). Stores AES-GCM ciphertext. Response: `{ ok, configured, last4 }`.
- `DELETE /api/users/me/byok` → clears stored ciphertext + model overrides.
- `PATCH /api/users/me/byok/models` → `byokModelsSchema` (`translateModelId?`, `explainModelId?`, may be `null` to clear). Validates `provider/model` shape only; OpenRouter is the authority on whether the model is real.

### Characters

A **Character** is the primary navigation surface.

- `GET /api/characters` → list owned by the current user (sorted by `sort_order`).
- `GET /api/characters/:characterId` → single character.
- `POST /api/characters` → `characterCreateSchema`: `name`, `sourceLanguage`, `targetLanguage` (BCP-47), `defaultVibe` (one of the 6 **Vibe stops**), `temperature` (0..1), `persona` (`{ age?, region?, formality?, traits: string[] }`).
- `PATCH /api/characters/:characterId` → partial update.
- `DELETE /api/characters/:characterId`.
- `POST /api/characters/reorder` → `characterReorderSchema` (`{ characterIds: uuid[] }`); rewrites `sort_order`.

### Threads

- `GET /api/threads?characterId=...` → threads under a character (sorted by `updated_at desc`).
- `GET /api/threads/:threadId` → single thread.
- `POST /api/threads` → `threadCreateSchema` (`characterId`, `title`).
- `PATCH /api/threads/:threadId` → `threadUpdateSchema` (`title?`, `archived?`, `starred?`). Starring alone does not bump `updated_at`.
- `DELETE /api/threads/:threadId`.
- Thread rows carry `starred` and `segmentCount` (a correlated subquery) so the sidebar can render "N translations" without a second request.

### Thread sharing (Share links)

One read-only public link per Thread.

- `GET /api/threads/:threadId/share` → `{ shared, token, url }` for the live link, or `{ shared: false, token: null, url: null }`.
- `POST /api/threads/:threadId/share` → mints a token, or returns the existing live one → `{ shared: true, token, url }` — `201` when minted, `200` when reused. `url` is `${APP_URL}/share/<token>`. At most one live link per Thread is enforced by a partial unique index, so concurrent POSTs converge on one token. `404` missing thread, `403` someone else's, `409` archived thread (the public resolver would 404 it).
- `DELETE /api/threads/:threadId/share` → revokes (sets `thread_shares.revoked_at`); a later POST mints a fresh token.
- `GET /api/share/:token` → **public**. Returns `{ thread: { title, createdAt, updatedAt }, character: { name, initials, color, sourceLanguage, targetLanguage, defaultVibe }, segments: [{ id, sourceText, targetText, vibe, tokenAlignment, createdAt }] }`. Redacted by construction: no user ids, no token usage, no credits. `404` for unknown, revoked, or archived-thread tokens. `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and `Referrer-Policy: no-referrer` on every response, errors included. At most 500 Segments (oldest first).

### Segments

- `GET /api/segments?threadId=...` → segments inside a thread.
- `POST /api/segments` → `segmentCreateSchema` (`threadId`, `sourceText`, `vibe?`). **Sync translate-and-return** — the worker resolves the Character (default_vibe, temperature, persona, source/target language), calls the translation provider, and returns a Segment with **server-produced** `targetText` and `tokenAlignment`. Omit `vibe` to select `characters.default_vibe` for this translation. The resolved stop is stored on the Segment; legacy null stops are returned as null ("Vibe not recorded"), including on public shares. Client does **not** supply target text.
  - **Free, instant pre-checks before any model call:** (1) an existing in-thread Segment for the same `(thread, sourceText, vibe)`, and (2) for _canonical_ requests (no persona fields — tone and verbosity included — no instructions, default temperature), a shared `translation_cache` hit. Either path costs **0 credits**.
  - **Charge ordering:** the credit hold is refunded only when the model call or the Segment insert fails. Once the Segment is stored it is charged, and the post-commit steps (cache seeding, thread recency, activity log) are best-effort and never refund. A Segment served from the shared cache carries `tokenUsage: { cached: true }`.
  - Latency budget: ~1–4s depending on model and target length. Clients render a spinner; no streaming today (see [adr/0002](./adr/) if/when streaming lands).
  - Errors: `402 Payment Required` if the user's `credits_balance` is insufficient and BYOK is not configured (standard error envelope with a message only; the client links to pricing / BYOK), `502` if the provider returns malformed output, `504` on provider timeout, `400/422` on schema failure. BYOK users skip the credit check entirely.
- `POST /api/segments/:segmentId/retry` → re-runs the translation for an existing Segment at its stored vibe and **overwrites the row in place** (`targetText`, `tokenAlignment`, `tokenUsage`). Deliberately bypasses the in-thread dedupe and the shared cache (the point is a fresh sample) and never seeds the cache. Drops the Segment's `explains` rows (keyed by the old target text). Same credit/BYOK rules and error codes as create. The overwrite and the Explain drop are one owner-scoped statement; if the Segment was deleted mid-flight the hold is refunded and the route returns `404`. Bumps the Thread's `updatedAt`.
- `PATCH /api/segments/:segmentId` → partial update. Allows manual edits to `sourceText`, `targetText`, `vibe`, `tokenAlignment` for stored history (e.g. a learner tweaking a translation by hand). Edits to `sourceText` trigger an embedding refresh.
- `DELETE /api/segments/:segmentId` → cascades to the row's `explains` rows.
- `GET /api/segments/:segmentId/explain` → returns the Explain payload for a Segment. Generate-on-miss with cross-segment dedupe:
  1. Look up `explains` by `(segment_id, version = EXPLAIN_PAYLOAD_VERSION)`.
  2. If missing, look up by `(user_id, target_language, target_text_hash, version)` — same target text in another Segment reuses one row.
  3. Otherwise generate via `api/_lib/explain.ts → generateExplain`, insert, return.
     Response: `{ segmentId, version, body, cached }`. Pro+ only.

### Memory (Translation memory)

- `GET /api/memory?q=<text>&characterId?=<uuid>&targetLanguage?=<bcp47>&limit?=10` → embeds `q`, runs cosine similarity against the user's `segments.source_embedding`, returns top-K matches as `{ segmentId, similarity }[]`. Optional filters scope the search to one Character or one target language. Pro+ only.

### Activity

- `GET /api/activity` → recent activity for the current user.

### Onboarding

- `POST /api/onboarding/dictate` → `onboardingDictateSchema` (`prompt`). Parses a free-form description into a **Character draft** (`{ ok, name?, sourceLanguage?, targetLanguage?, defaultVibe?, temperature?, persona?, instructions? }`). `ok: false` → client falls back to the empty Character form. **Free** (platform-paid), one-shot, rate-limited per user, and only served while `onboarding_complete = false`. Uses the `dictation` model.

### AI

- `POST /api/ai/dictation` → same Character-draft parse as onboarding, but the **Pro+, credit-charged** in-app path for spinning up further Characters by voice.
- `POST /api/ai/text-to-speech` → `textToSpeechSchema` (`text`, `vibe`, `languageCode?`). **Authenticated, Pro+ only (`tierLimits.*.elevenLabsTts`), Japanese only today** — `403` on the free tier, `400` for a non-`ja` `languageCode`. Both are fall-back signals: the client reads back with the browser's speech synthesis (`app/lib/tts.ts`) for the free tier, other languages, and any ElevenLabs failure. Proxies to ElevenLabs; returns an `audio/mpeg` stream. Voice IDs per **Vibe stop** are configured via `ELEVENLABS_VOICE_*` env vars. Returns `503` if unconfigured, `502` if ElevenLabs is unreachable or errors. The anonymous landing demo does not call this — it plays pre-rendered `public/demo/vibe-*.mp3` clips.

### Billing

- `POST /api/billing/checkout` → `checkoutSchema` (`plan: 'pro' | 'team'`, `billingPeriod: 'monthly' | 'annual'` default `monthly`) → `{ checkoutUrl, plan }`. Creates a Dodo checkout session stamped with `metadata.user_id` (the Better Auth user id); the client redirects to `checkoutUrl`. `503` if Dodo / the plan's product id is unconfigured, `502` on a Dodo error.
- `POST /api/billing/switch-plan` → `checkoutSchema` → `{ ok, plan }`. Calls Dodo change-plan (prorated immediately) on the user's `subscription_id`. `409` if the user has no active subscription.
- `POST /api/billing/cancel` → `{ ok }`. Cancels at end of the billing period (`cancel_at_next_billing_date`). `409` if no active subscription.
- Cancel and switch-plan do **not** mutate `users.tier` directly — the resulting `subscription.cancelled` / `subscription.plan_changed` webhook is the single source of truth (see [adr/0005](./adr/0005-commerce-checkout-and-webhook-idempotency.md)).
- `POST /api/billing/webhooks/dodo` → **unauthenticated by design** (exempt from `auth()`); verifies the Standard Webhooks signature on the raw body, is idempotent via `webhook_events`, and applies tier/credit changes. Owned in `api/_lib/payments.ts` (see [SECURITY.md](./SECURITY.md#webhook-signatures)).

### Utility

- `POST /api/waitlist` → `waitlistSchema` (email + optional source).
- `GET /api/export` → `{ characters, threads, segments, activity }` for the current user.

## Conventions

- **Pagination** is not implemented yet. When it lands, use `?cursor=` opaque cursors, not offsets.
- **Bulk endpoints** are dedicated (e.g. `/characters/reorder`) rather than overloading PATCH.
- **Vibe** is always one of the six universal stop IDs in request bodies. Display labels are a client-side concern and never round-trip through the API.
- **Locales** are BCP-47 (`en-US`, `ja-JP`). The TTS endpoint accepts the same and normalizes to the ElevenLabs two-letter code internally.

## Open questions

- ~~Webhook surface: do we need identity-provider webhooks (user-deleted, email-changed) wired to the DB?~~ **Resolved:** no. Identity lives in our own DB ([adr/0008](./adr/0008-better-auth-replaces-clerk.md)). Deleting an `auth_users` row cascades through all app data, and `users.email` is refreshed from the session on every guarded call.
- Should `/api/memory` also return embedding-similarity scores normalized 0..1, or expose raw cosine distance? (Today: similarity 0..1.)
