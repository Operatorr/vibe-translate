# ARCHITECTURE.md

The top-level map of Vibe Translate. Start here, then follow the links into the specialized docs under [`docs/`](./docs).

## What it is

A language-learning translator that lets the user pick the social **register** ("vibe") of a translation, hear it in a matching voice, and drill into the grammar behind it. Japanese is the anchor language. Product detail: [docs/PRODUCT.md](./docs/PRODUCT.md). Domain vocabulary: [CONTEXT.md](./CONTEXT.md).

## Shape

Single-page React app served by a Cloudflare Worker API, backed by Postgres (Neon) reached through Hyperdrive.

```
Browser (React SPA, app/)
   │  fetch via app/lib/api.ts  (bearer token / __session cookie)
   ▼
Cloudflare Worker (Hono, api/app.ts via functions/api/[[route]].ts)
   │  auth → Zod validation → handler
   ├── Clerk            (identity)
   ├── OpenRouter       (translate / explain / dictation models)
   ├── OpenAI           (embeddings)
   ├── ElevenLabs       (per-vibe TTS)
   ├── Dodo Payments    (subscriptions)
   └── Resend           (email)
   │
   ▼
Postgres + pgvector  (via Hyperdrive)
```

## Domains

| Domain | Lives in | Doc |
| --- | --- | --- |
| Frontend SPA | `app/` | [docs/FRONTEND.md](./docs/FRONTEND.md) |
| Design system & interactions | `app/styles/`, `app/components/` | [docs/DESIGN.md](./docs/DESIGN.md) |
| Worker / server logic | `api/app.ts`, `api/_lib/` | [docs/BACKEND.md](./docs/BACKEND.md) |
| HTTP API surface | `api/app.ts` | [docs/API.md](./docs/API.md) |
| Data model | `db/` | [docs/DATABASE.md](./docs/DATABASE.md) |
| Platform / runtime | `wrangler.toml`, `functions/` | [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md) |
| Deploy & environments | — | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Security & abuse | cross-cutting | [docs/SECURITY.md](./docs/SECURITY.md) |

## Core domain model

**Character → Thread → Segment**, plus per-user **Translation memory** and **Explain memory**, a shared **Translation cache**, **Credits**/**BYOK**, and a **Model registry**. The shape and the reasons behind it:

- [adr/0001](./docs/adr/0001-character-thread-segment-model.md) — Character / Thread / Segment.
- [adr/0002](./docs/adr/0002-translation-and-explain-memory.md) — translation & explain memory (pgvector).
- [adr/0003](./docs/adr/0003-credits-byok-and-model-registry.md) — credits, BYOK, model registry.
- [adr/0004](./docs/adr/0004-shared-canonical-translation-cache.md) — shared canonical translation cache.

## Boundaries (load-bearing rules)

- **The SPA never imports from `api/_lib/`; the worker never imports from `app/`.** The only browser↔worker channel is `app/lib/api.ts` → `/api/*`.
- **Every API input is validated with Zod** at the boundary (`api/_lib/schemas.ts`).
- **Every per-user row is scoped by `clerk_user_id`.** See [docs/SECURITY.md](./docs/SECURITY.md#per-user-scoping).
- **The six Vibe stop IDs are a contract** shared by the DB enum, `api/_lib/schemas.ts → VIBE_STOPS`, and the client preset table. Keep all three in lockstep.
- **Embeddings are platform-owned** (never BYOK) so the corpus stays cosine-comparable.

## Tech choices worth knowing

- **Hono** on Workers for the API; **TanStack Router + Query** on the SPA.
- **Postgres + pgvector** for relational data *and* embedding retrieval in one store.
- **Model selection is data** (`models` table), not config — swap defaults with SQL, no deploy.
- Two environments only — **Local + Production** — with separate Neon databases. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
