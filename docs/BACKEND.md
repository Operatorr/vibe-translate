# BACKEND.md

> Domain terms below are defined in [../CONTEXT.md](../CONTEXT.md). The HTTP routes are documented in [API.md](./API.md); the database in [DATABASE.md](./DATABASE.md).

## Shape

- **Hono** app in [`api/app.ts`](../api/app.ts). Exposed to Cloudflare Workers through [`functions/api/[[route]].ts`](../functions/api/[[route]].ts), which is a one-line re-export.
- All server-only helpers live in [`api/_lib/`](../api/_lib). The `_lib` prefix is a hard signal that nothing in the SPA may import from here.
- TypeScript-only. No build step beyond Wrangler's bundler; `pnpm build` runs `tsc --noEmit && vite build`, which type-checks server code as a side effect.

## Module map (`api/_lib/`)

| Module | Role |
| --- | --- |
| `auth.ts` | Clerk bearer / `__session` cookie verification, sets `userId`, `email`, `databaseUrl` on Hono context. |
| `db.ts` | `createDbClient(env)` → `pg.Client` from the Hyperdrive connection string. |
| `env.ts` | Typed bindings (Clerk keys, Hyperdrive, ElevenLabs voice IDs, Dodo, Resend, OpenRouter) and Hono `Variables`. |
| `schemas.ts` | All Zod request schemas + the canonical `VIBE_STOPS` list + the `Persona` schema. **Single source of truth for the 6-stop vibe enum on the server.** |
| `validation.ts` | `parseJson(schema, value)` — manual fallback when `zValidator` middleware isn't a fit. |
| `errors.ts` | `formatError(unknown)` — uniform JSON error envelope; converts `HTTPException`, `ZodError`, `Error`, and unknowns. |
| `permissions.ts` | `assertUserOwnsResource`, `canUseFeature` — small guard helpers. |
| `tier.ts` | `tierLimits` for `free` / `pro` / `team` and the `Tier` type. Tier carries the monthly **Credits** allowance and feature flags. |
| `models.ts` | Reads the active default model per task (`translate`, `explain`, `embed`) from the `models` table. Operators flip defaults with SQL — no deploy. |
| `credits.ts` | Token-derived credit accounting: `computeCredits`, `recordSpend`, `recordGrant`, `getBalance`. Transactional writes keep `users.credits_balance` in sync with `credit_ledger`. |
| `secrets.ts` | AES-GCM `encryptSecret` / `decryptSecret` for at-rest BYOK keys, using `CREDENTIALS_ENCRYPTION_KEY`. Storage format: `base64(iv):base64(cipher)`. |
| `activity.ts` | `logActivity(db, userId, action, metadata?)` — write to `activity_log`. |
| `recurrence.ts` | `getRetentionWindow(retentionDays)` — date math for retention queries (driven by tier). |
| `ai.ts` | Translation + dictation provider helpers. `translateSegment(...)` → `{ targetText, tokenAlignment, tokenUsage }`; owns prompt construction for **Vibe**, **Persona**, **Instructions**, **Temperature** and the OpenRouter call. `draftCharacterFromDictation(prompt)` → a **Character draft** (`ok: false` signals fall-back-to-form). |
| `embeddings.ts` | `embedText({ text })` → `{ modelId, vector, promptTokens }`. Owns the embedding model + dimension (`EMBEDDING_DIMENSIONS = 3072`). Also `sha256Hex(text)` for the Explain memory dedupe key and cache fingerprints. |
| `translation-cache.ts` | Shared canonical translation cache: `isCanonical`, `fingerprint`, `lookupCache`, `upsertCache`. Cache hits cost 0 credits. See [adr/0004](./adr/0004-shared-canonical-translation-cache.md). |
| `explain.ts` | `generateExplain({ sourceText, sourceLanguage, targetText, targetLanguage, persona })` → `{ version, body, tokenUsage }`. Exports `EXPLAIN_PAYLOAD_VERSION`; bumping invalidates older `explains` rows. |
| `payments.ts` | Stub for Dodo Payments checkout. Webhook handler in `app.ts` will route here. |
| `email.ts` | Stub for Resend transactional email. |

## Boundaries

- **The SPA never imports from `api/_lib/`.** Browser code talks to the worker via `app/lib/api.ts`.
- **The worker never imports from `app/`.** No shared types across the boundary — frontend types in `app/lib/types.ts` are defined independently from Zod inferences in `api/_lib/schemas.ts` (they should agree, but agreement is enforced by tests + reviews, not by a generator).
- **Request body validation must use Zod** at every authenticated mutation route. Use the existing `@hono/zod-validator` middleware. Don't reach for `c.req.json()` without a schema.

## Authentication and user provisioning

- **Clerk** is the identity provider for both directions:
  - Frontend: `@clerk/react`, `ClerkProvider` wraps the SPA.
  - Backend: `@clerk/backend → createClerkClient + authenticateRequest`.
- Accepted credentials, in order: `Authorization: Bearer <token>`, then the `__session` cookie. Reject with `401` otherwise.
- On the first authenticated request to any guarded route, the user is **upserted** into the local `users` table (driven from `auth.ts`). The local row carries `tier`, `subscription_id`, `onboarding_complete`, `locale`.

## Authorization

- **Per-user scoping** is the primary axis. Every row in `characters`, `threads`, `segments`, `activity_log` carries `user_id = clerk_user_id`. All read and write queries must filter by it. `assertUserOwnsResource(row.user_id, c.get('userId'))` is the explicit guard when ownership needs to be checked imperatively (e.g. after a single-row lookup).
- **Tier gates** use `canUseFeature(tierLimits[user.tier].aiDictation)` etc. Caps (characters per user, threads per character, segments per month) are enforced inline before the insert.

## Tiers

Defined in [`api/_lib/tier.ts`](../api/_lib/tier.ts):

| | `free` | `pro` | `team` |
| --- | --- | --- | --- |
| `characters` | 5 | 100 | 1000 |
| `threadsPerCharacter` | 20 | 200 | 2000 |
| `credits` (monthly) | 1 000 | 25 000 | 250 000 |
| `retentionDays` | 30 | 365 | 1095 |
| `aiDictation` | ❌ | ✅ | ✅ |
| `explain` | ❌ | ✅ | ✅ |
| `translationMemory` | ❌ | ✅ | ✅ |
| `customVibeStops` | ❌ | ❌ | ✅ |

Notes:

- All three tiers use the **same models** (see [DATABASE.md → models](./DATABASE.md#models)). Upgrades buy capacity and features, not output quality.
- `customVibeStops` is the team-tier extension hinted at in the pricing prototype ("6 + custom registers"). Free and Pro are pinned to the canonical six.
- `explain` and `translationMemory` are the persistent-corpus features. Free tier still creates Segments and sees alignment hover, but the Explain button surfaces an upsell and `/api/memory` returns `403`.
- **BYOK users bypass `credits` entirely.** A free-tier user with a stored OpenRouter key can translate as much as they want.

## Integrations

| Integration | Purpose | Notes |
| --- | --- | --- |
| **Clerk** | Auth (sessions, user records) | secret + publishable keys; both required to authenticate requests. |
| **Cloudflare Hyperdrive** | Postgres connection pool at the edge | `HYPERDRIVE.connectionString`; falls back to `DATABASE_URL` in local dev. |
| **OpenRouter** | LLM provider for translation + dictation processing | `OPENROUTER_API_KEY`; routing/model selection lives in `ai.ts` (to be wired). |
| **ElevenLabs** | TTS | One voice ID per **Vibe stop** (`ELEVENLABS_VOICE_<STOP>`); proxied from `/api/ai/text-to-speech`. The `ja` language code triggers `apply_language_text_normalization: true`. |
| **Dodo Payments** | Subscriptions | `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`; checkout + webhooks in `payments.ts` (stub). |
| **Resend** | Transactional email | `RESEND_API_KEY`; stub in `email.ts`. |

## Error model

- All errors flow through `app.onError → formatError`.
- `HTTPException` propagates its status. `ZodError` becomes `422` with `details: error.flatten()`. Anything else becomes a generic `500` with the message preserved.
- The envelope shape is `{ error: { message, status, details? } }`. The SPA's `app/lib/api.ts` matches on this shape.

## Activity log

Writes go through `activity.ts → logActivity`. Action strings are free-form for now but should be `<noun>.<verb>` (e.g. `character.created`, `segment.regenerated`, `tier.upgraded`). Metadata is a small jsonb blob — keep it under a few kilobytes.

## Translation request flow

The Segment-create path is **synchronous translate-and-return** plus an embedding write (see ADR 0001 + 0002 + 0003).

```
client POST /api/segments { threadId, sourceText, vibe? }
  └─ resolve Character (default_vibe, temperature, persona, instructions, langs)
  └─ PRE-CHECK 1: in-thread Segment for (thread, source_text, vibe)?  → return it, 0 credits
  └─ PRE-CHECK 2: canonical request? → translation_cache fingerprint lookup
       └─ hit → copy target_text + token_alignment + source_embedding into a
                new Segment, 0 credits, done
  └─ MISS → resolve call target:
       ├─ BYOK key present → decrypt, use user key + BYOK model override (or default)
       └─ else → platform key + models[translate].default; pre-check credits_balance > 0 (else 402)
  ├─ ai.translateSegment(...)                    ← one OpenRouter call
  ├─ embeddings.embedText({ text: sourceText })  ← always platform key + platform embed model
  └─ insert segments (server-produced fields + source_embedding)
  └─ if canonical → translation-cache.upsertCache(...)
  └─ if platform-key path → credits.recordSpend(...) inside a transaction
  ← Segment row
```

"Commit-to-translate" (the UI fires one call per intended translation, not per slider move — see [DESIGN.md](./DESIGN.md#the-vibe-slider)) plus the two pre-checks means sliding between already-generated stops is instant and free.

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
- Tier `segmentsPerMonth` cap is enforced *before* the provider call so a quota-busting attempt doesn't burn tokens.
- Provider timeout → `504`. Malformed model output (alignment parse failure) → `502`. Tier cap hit → `403`.
- Streaming is intentionally deferred — the structured output (`targetText` + `tokenAlignment` + Explain hooks) doesn't streaming-render cleanly, and the latency budget (~1–4s) fits a spinner. Revisit when load data warrants it.

## Open questions

- The `ai.ts` module is the right place for prompt construction. Open: do we keep prompts inline, or factor them into a `prompts/` directory with one file per template (translate, dictate, explain)?
- Should `payments.ts` validate Dodo webhook signatures via `DODO_WEBHOOK_SECRET` before the body parser runs, or is the current "parse then validate" pattern fine?
