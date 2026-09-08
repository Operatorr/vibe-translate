# DATABASE.md

> Domain terms below are defined in [../CONTEXT.md](../CONTEXT.md). The data model itself is motivated in [adr/0001-character-thread-segment-model.md](./adr/0001-character-thread-segment-model.md).

## Engine and binding

- **PostgreSQL** is the primary datastore. The **`pgvector`** extension is a hard runtime dependency — translation memory retrieval depends on it.
- In Cloudflare Workers, the database is reached through a **Hyperdrive** binding (`HYPERDRIVE` in `wrangler.toml`), which pools and caches Postgres connections at the edge.
- In local dev, `HYPERDRIVE.localConnectionString` points at a developer Postgres (Neon, local Docker, etc.); the connection string is read by `api/_lib/db.ts` and used to spin up a `pg.Client` per request.
- The bootstrap schema lives in [`db/schema.sql`](../db/schema.sql). Incremental migrations live in [`db/migrations/`](../db/migrations) (sequential, e.g. `0001_initial.sql`).

## Domain model

```
users (1) ── owns ──> (N) characters
                        │
                        └─ has ──> (N) threads ──> (0..1 live) thread_shares
                                     │
                                     └─ has ──> (N) segments ──> source_embedding (vector(1536))
                                                  │
                                                  └─ has ──> (N) explains  (one per version)
```

The product-shaped tables are `characters`, `threads`, `segments`, `explains`. They map onto **Character → Thread → Segment** plus **Translation memory** (embedding column on `segments`) and **Explain memory** (`explains` table). See [adr/0002-translation-and-explain-memory.md](./adr/0002-translation-and-explain-memory.md).

### Enums

`vibe_stop` — a Postgres enum with the six universal **Vibe stop** IDs:
`'yakuza', 'friend', 'casual', 'keigo', 'keigoplus', 'emperor'`.

The enum is defined on the database so the schema is self-describing for agents that introspect it (`select unnest(enum_range(null::vibe_stop));`). The same six IDs live in `api/_lib/schemas.ts → VIBE_STOPS` and the frontend `VIBE_PRESETS_PER_LANG` design data. **The list is the truth in three places; keep them in lockstep.**

### Tables

#### `users`

Provisioned on first authenticated request by `api/_lib/auth.ts`. Keyed by the Clerk user ID (text, FK target for all per-user tables).

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | local primary key |
| `clerk_user_id` | text unique | the FK target for everything user-scoped |
| `email`, `display_name`, `locale` | text | mirrored from Clerk |
| `tier` | text check (`free`/`pro`/`team`) | gates feature access in `api/_lib/tier.ts` |
| `subscription_id` | text nullable | Dodo Payments subscription id; partial-unique (`where subscription_id is not null`) so lifecycle webhooks can resolve the owning user. Set/cleared by the Dodo webhook. |
| `onboarding_complete` | boolean | gates the `/app` shell |
| `credits_balance` | int | spendable on the platform-key path; debited per token spend |
| `credits_refilled_at` | timestamptz | last monthly grant; drives the refill scheduler |
| `openrouter_api_key_cipher` | text nullable | AES-GCM ciphertext of the user's BYOK key |
| `openrouter_api_key_last4` | text nullable | last 4 chars for UI display; safe to expose |
| `byok_translate_model_id` | text nullable | OpenRouter slug override; `null` = use default |
| `byok_explain_model_id` | text nullable | OpenRouter slug override; `null` = use default |
| `created_at`, `updated_at` | timestamptz | |

#### `characters`

A persistent persona the user translates *toward*. One row = one **Character**.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_id` | text fk → `users.clerk_user_id` on delete cascade | per-user scoping |
| `name` | text | display name, e.g. "Oba-chan" |
| `initials`, `color` | text | UI ornamentation |
| `source_language`, `target_language` | text | BCP-47 codes (`en-US`, `ja-JP`) |
| `default_vibe` | `vibe_stop` not null | the default **Vibe** for new Segments |
| `temperature` | numeric(3,2) bounded 0..1, default 0.40 | per-Character model temperature |
| `persona` | jsonb default `{}` | *structured* attributes `{ age, region, formality, traits: string[] }` — UI chips + form |
| `instructions` | text nullable | *free-form* system-prompt extension appended at translate time; populated by dictation or hand-edited |
| `sort_order` | int | user-controlled ordering (reorder endpoint) |
| `archived_at` | timestamptz nullable | soft-archive |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(user_id, sort_order)`.

#### `threads`

A topic-level conversation under one Character.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `character_id` | uuid fk → `characters.id` on delete cascade | |
| `user_id` | text fk → `users.clerk_user_id` on delete cascade | denormalised for retention queries |
| `title` | text | e.g. "Asking for grandma's recipe" |
| `archived_at` | timestamptz nullable | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(character_id, updated_at desc)`, `(user_id, updated_at desc)`.

#### `threads` — sharing & starring

- `threads.starred boolean` — pins the Thread under a STARRED group in the sidebar. Metadata only; toggling it does not touch `updated_at`.
- **`thread_shares`** — one read-only public link per Thread. `token text unique` is an unguessable base64url string (24 random bytes) resolved by `GET /api/share/:token` **without auth**; `revoked_at` disables it. Cascades from `threads` and `users`. Added in `0005_thread_star_share.sql`.

#### `segments`

One source-text → target-text translation inside a Thread.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `thread_id` | uuid fk → `threads.id` on delete cascade | |
| `user_id` | text fk → `users.clerk_user_id` on delete cascade | denormalised for retention queries |
| `source_text` | text not null | what the user typed |
| `target_text` | text not null | model output |
| `vibe` | `vibe_stop` **nullable** | `null` = inherit `characters.default_vibe`. Renderers must resolve. |
| `token_alignment` | jsonb default `[]` | array of `{ t, src }` — target token + matched source span. Drives hover-to-align UI. |
| `token_usage` | jsonb default `{}` | model accounting: `{ model_id, prompt_tokens, completion_tokens, cost_cents }` |
| `metadata` | jsonb default `{}` | catch-all (model id used, retrieval hits considered, etc.) |
| `source_embedding` | `vector(1536)` nullable | Embedding of `source_text`. Powers Translation memory retrieval (HNSW + cosine). `null` = excluded from search until backfill. |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(thread_id, created_at desc)`, `(user_id, created_at desc)`, `using hnsw (source_embedding vector_cosine_ops)`.

#### `explains`

The Explain Memory store. One row per `(segment_id, version)`.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `segment_id` | uuid fk → `segments.id` on delete cascade | |
| `user_id` | text fk → `users.clerk_user_id` on delete cascade | |
| `target_language` | text | e.g. `ja-JP` — drives payload shape |
| `target_text` | text | denormalised from the source Segment for cross-segment dedupe |
| `target_text_hash` | text | sha-256 hex of `target_text` |
| `version` | int | bumped when the Explain payload schema changes; older rows are re-generated on next read |
| `body` | jsonb | language-specific payload (romaji, morphemes, kanji, grammar for Japanese; other shapes for other languages) |
| `token_usage` | jsonb default `{}` | model accounting for the Explain generation call |
| `created_at` | timestamptz | |

Indexes: `(segment_id, version desc)`, unique `(user_id, target_language, target_text_hash, version)`, `(user_id, created_at desc)`. The unique index is what makes cross-segment reuse possible — same Japanese sentence explained twice maps to one row.

#### `models`

The model registry. One default row per task. Operators can flip the default with a single SQL update (`update models set is_default = … where task = …`); no deploy is required.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `task` | text check `('translate','explain','embed','dictation')` | |
| `provider` | text | e.g. `'openrouter'`, `'openai'` |
| `provider_model_id` | text | e.g. `'deepseek/deepseek-v4-pro'` |
| `display_name` | text | for admin UI / logs |
| `is_default` | boolean | unique-by-task while true (partial index) |
| `embedding_dimensions` | int nullable | set only for `task='embed'`; must match `segments.source_embedding vector(…)` |
| `credit_cost_multiplier` | numeric(6,3) default 1.000 | applied to (prompt_tokens + completion_tokens) when computing credits |
| `notes` | text | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: unique `(task) where is_default`, unique `(task, provider, provider_model_id)`.

**Seeded defaults** (idempotent in 0001):

| task | provider/model | dims |
| --- | --- | --- |
| translate | `openrouter / deepseek/deepseek-v4-pro` | — |
| explain | `openrouter / xiaomi/mimo-v2.5-pro` | — |
| dictation | `openrouter / google/gemini-2.5-flash` | — |
| embed | `openrouter / openai/text-embedding-3-small` | 1536 |

`dictation` is its own task so operators can point onboarding parsing at a cheap, fast, structured-output model independent of the translate model.

#### `credit_ledger`

Append-only audit log. Every credit grant (signup, monthly refill, manual adjustment) and every credit spend (translate, explain) writes a row. The sum of all `delta` for a user always equals `users.credits_balance` (invariant — assert in tests). A platform-path spend first writes a **pending** reservation row (`metadata.reservation = true`, delta = estimated hold) via `credits.reserveCredits`; `reconcileSpend` then rewrites that row's `delta`/`reference_id`/`metadata` to the real token cost, or `refundReservation` deletes it. The row is mutated in place, so the invariant holds at every step (this is the one place a `credit_ledger` row is updated/deleted rather than purely appended).

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_id` | text fk → `users.clerk_user_id` on delete cascade | |
| `delta` | int | positive = grant, negative = spend |
| `reason` | text | enum-shaped (`grant.signup`, `grant.monthly`, `grant.subscription`, `grant.adjustment`, `spend.translate`, `spend.explain`, `spend.dictation`) |
| `reference_id` | uuid nullable | e.g. the `segments.id` or `explains.id` the spend was for; `null` for in-app dictation |
| `metadata` | jsonb default `{}` | model id, token breakdown |
| `created_at` | timestamptz | |

Index: `(user_id, created_at desc)`.

#### `translation_cache`

Shared, cross-user cache of **canonical** translations (no persona, no instructions, default temperature). Privacy-safe — see [adr/0004](./adr/0004-shared-canonical-translation-cache.md). **No `user_id`** by design.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `fingerprint` | text unique | sha-256 of `(source_text, source_lang, target_lang, vibe, model_id)` |
| `source_language`, `target_language` | text | |
| `vibe` | `vibe_stop` | |
| `model_id` | text | which translate model produced it (part of the key) |
| `source_text`, `target_text` | text | the cached mapping |
| `token_alignment` | jsonb | copied into the per-user Segment on a hit |
| `source_embedding` | `vector(1536)` nullable | copied into the per-user Segment on a hit, avoiding a re-embed |
| `hits` | int | incremented per lookup; supports eviction |
| `created_at`, `last_used_at` | timestamptz | |

Index: unique `(fingerprint)`, `(last_used_at desc)`. Derived data — safe to truncate and rebuild.

#### `activity_log`

Per-user audit trail. Action strings are free-form for now (e.g. `character.created`, `segment.regenerated`). `metadata` captures payload context.

#### `waitlist`

Pre-launch signups, keyed by unique email.

#### `webhook_events`

Append-only dedupe ledger for provider webhooks (Dodo Payments). Keyed by the provider's event id — Dodo's Standard-Webhooks `webhook-id` header. The webhook handler inserts a row **inside the same transaction** as the tier/credit mutation, so a redelivered event is dropped before any grant runs. See [adr/0005](./adr/0005-commerce-checkout-and-webhook-idempotency.md).

| column | type | notes |
| --- | --- | --- |
| `event_id` | text pk | provider event id (Dodo `webhook-id`) |
| `source` | text default `'dodo'` | provider namespace, for future webhook sources |
| `event_type` | text nullable | e.g. `subscription.active` — informational |
| `received_at` | timestamptz | |

Derived/operational data — not user-scoped, no cascade.

## Invariants

- **Per-user scoping.** Every row in `characters`, `threads`, `segments`, `activity_log` is scoped by `user_id = clerk_user_id`. All queries must include the user filter — see [SECURITY.md](./SECURITY.md#per-user-scoping).
- **Cascade deletes** flow user → character → thread → segment. Deleting a user wipes all owned data.
- **`segments.vibe` nullability** is load-bearing — `null` means "use the Character's `default_vibe`". Do not default-write the resolved vibe into the row; the user changing `default_vibe` later should affect not-overridden segments retroactively.
- **`token_alignment` shape** is the same as the design prototype's `target` arrays in `data.js` (each entry `{ t, src }`). This is the contract between the model output and the frontend hover-alignment renderer.
- **Embeddings are derived data.** Source-of-truth is `source_text` (and for explains, `target_text` + `body`). Re-embedding is always safe; never trust the embedding vector over the underlying text.
- **Explain payload versioning.** Bumping `EXPLAIN_PAYLOAD_VERSION` in `api/_lib/explain.ts` invalidates older `explains` rows. The next read on those segments triggers re-generation. Old rows are retained as a fallback only — they should never be served above a newer one.
- **`segments.source_embedding` dimension must equal `models.embedding_dimensions` for the default embed row.** Today both are 1536 (`text-embedding-3-small`), which keeps the column within pgvector's 2,000-dim HNSW index limit. A future embed model swap requires (a) an `alter table` to change the vector dimension, (b) re-embedding every existing Segment, (c) updating the default `models` row. There is no migration shortcut. `db/migrations/0004_embed_dims_1536.sql` is the worked example: it drops the HNSW index, `alter`s `source_embedding` to `vector(1536)` resetting data to `null` (3072→1536 isn't convertible; rows re-embed on demand), recreates the index, and re-points the `models` embed row — all guarded so it's a no-op on an already-1536 database.
- **Credit-balance invariant.** `users.credits_balance = sum(credit_ledger.delta)` per user. Spend and grant writes happen inside a transaction so the two never drift.

## Migrations

- New incremental changes go in `db/migrations/000N_<slug>.sql`. Apply manually for now; deploy hooks land later.
- `db/schema.sql` is the canonical bootstrap — keep it in sync with the latest migration so fresh environments are one step.
- The `0001_initial.sql` migration establishes the Character/Thread/Segment model directly; there is no pre-character schema in production. Later migrations are additive: `0002_commerce.sql` (webhook idempotency + `subscription_id` index), `0003_embed_via_openrouter.sql` (embed routed via OpenRouter), `0004_embed_dims_1536.sql` (embed columns/model to 1536 for any pre-1536 DB).
- **Never edit an applied migration in place.** Because every statement is `if not exists` / `on conflict do nothing` / type-guarded, re-running an edited file won't change existing objects — only a new forward migration reaches provisioned databases.

## Open questions

- Should `segments.token_usage` be a separate `segment_usage` table for billing-grade accuracy, or is the jsonb good enough?
- Should we add a `custom_vibe_stops` table for Team tier custom registers, or extend `vibe_stop` per-team? (Probably a separate table — enum changes are heavy.)
