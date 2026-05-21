# API.md

> Domain terms below are defined in [../CONTEXT.md](../CONTEXT.md). The HTTP routes live in [`api/app.ts`](../api/app.ts).

## Shape

- **Hono** app, deployed as a Cloudflare Worker via `functions/api/[[route]].ts`.
- All routes are prefixed `/api/*`. The worker handles `/api/*` before the static asset binding takes over.
- Request bodies are validated with **Zod** schemas from [`api/_lib/schemas.ts`](../api/_lib/schemas.ts). Validation runs as Hono middleware (`@hono/zod-validator`); a failed schema returns `400` with a normalized error from `formatError`.
- Errors are returned as JSON `{ error: { ... } }`. `api/_lib/errors.ts → formatError` converts `HTTPException`, Zod errors, auth errors, and unknown errors into a single envelope shape.
- **No API versioning today.** Breaking changes are coordinated across the SPA and worker since they ship together.

## Auth

- Bearer token *or* `__session` cookie, verified against Clerk by `api/_lib/auth.ts → auth()`.
- The middleware also **upserts** the Clerk user into the local `users` table on first authenticated call and stores `userId`, `email`, and the DB connection string on Hono context (`c.get('userId')`, etc.).
- The CORS layer allows the `APP_URL` origin only, with credentials, and the `authorization` + `content-type` headers.

| Guarded prefix | Notes |
| --- | --- |
| `/api/users/*` | `auth()` |
| `/api/characters/*` | `auth()` |
| `/api/threads/*` | `auth()` |
| `/api/segments/*` | `auth()` |
| `/api/memory` | `auth()` |
| `/api/activity/*` | `auth()` |
| `/api/onboarding/*` | `auth()` |
| `/api/ai/dictation` | `auth()` |
| `/api/ai/text-to-speech` | `auth()` |
| `/api/billing/*` | `auth()` |
| `/api/export` | `auth()` |

Unguarded (intentionally public): `/api/health`, `/api/diagnostics`, `/api/waitlist`. **`/api/ai/text-to-speech` is authenticated** — it proxies to metered ElevenLabs, so the landing demo uses pre-rendered clips instead (see [SECURITY.md](./SECURITY.md#the-unauthenticated-surface)).

## Surface

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
- `PATCH /api/threads/:threadId` → `threadUpdateSchema` (`title?`, `archived?`).
- `DELETE /api/threads/:threadId`.

### Segments

- `GET /api/segments?threadId=...` → segments inside a thread.
- `POST /api/segments` → `segmentCreateSchema` (`threadId`, `sourceText`, `vibe?`). **Sync translate-and-return** — the worker resolves the Character (default_vibe, temperature, persona, source/target language), calls the translation provider, and returns a Segment with **server-produced** `targetText` and `tokenAlignment`. Omit `vibe` to inherit `characters.default_vibe`. Client does **not** supply target text.
  - **Free, instant pre-checks before any model call:** (1) an existing in-thread Segment for the same `(thread, sourceText, vibe)`, and (2) for *canonical* requests (no persona/instructions, default temperature), a shared `translation_cache` hit. Either path costs **0 credits**.
  - Latency budget: ~1–4s depending on model and target length. Clients render a spinner; no streaming today (see [adr/0002](./adr/) if/when streaming lands).
  - Errors: `402 Payment Required` if the user's `credits_balance` is insufficient and BYOK is not configured (the response includes how many credits are short and the upgrade URL), `502` if the provider returns malformed output, `504` on provider timeout, `400/422` on schema failure. BYOK users skip the credit check entirely.
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
- `POST /api/ai/text-to-speech` → `textToSpeechSchema` (`text`, `vibe`, `languageCode?`). **Authenticated.** Proxies to ElevenLabs; returns an `audio/mpeg` stream. Voice IDs per **Vibe stop** are configured via `ELEVENLABS_VOICE_*` env vars. Returns `503` if unconfigured, `502` if ElevenLabs is unreachable or errors. The anonymous landing demo does not call this — it plays pre-rendered `public/demo/vibe-*.mp3` clips.

### Billing

- `POST /api/billing/checkout` → `checkoutSchema` (`plan: 'pro' | 'team'`) → returns a Dodo checkout URL.
- `POST /api/billing/cancel`, `POST /api/billing/switch-plan`.
- `POST /api/billing/webhooks/dodo` → unauthenticated; Dodo signature verification owned in `api/_lib/payments.ts` (see [SECURITY.md](./SECURITY.md#webhook-signatures)).

### Utility

- `POST /api/waitlist` → `waitlistSchema` (email + optional source).
- `GET /api/export` → `{ characters, threads, segments, activity }` for the current user.

## Conventions

- **Pagination** is not implemented yet. When it lands, use `?cursor=` opaque cursors, not offsets.
- **Bulk endpoints** are dedicated (e.g. `/characters/reorder`) rather than overloading PATCH.
- **Vibe** is always one of the six universal stop IDs in request bodies. Display labels are a client-side concern and never round-trip through the API.
- **Locales** are BCP-47 (`en-US`, `ja-JP`). The TTS endpoint accepts the same and normalizes to the ElevenLabs two-letter code internally.

## Open questions

- Webhook surface: do we need Clerk webhooks (user-deleted, email-changed) wired to the DB? Today auth-on-request upserts on first call only.
- Should `/api/memory` also return embedding-similarity scores normalized 0..1, or expose raw cosine distance? (Today: similarity 0..1.)
