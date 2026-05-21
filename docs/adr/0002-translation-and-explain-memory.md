---
status: accepted
---

# Translation memory and Explain memory as first-class persistent stores

Every **Segment** and every **Explain** the user generates is stored as long-lived data, not transient cache, and is made retrievable via embedding similarity search. The user's accumulated translations are the asset.

`segments` carries a `source_embedding vector(1536)` populated at create time. Past translations are searchable via cosine similarity (pgvector HNSW index) so a user can answer *"did we already translate something like this?"*. Explanations live in a dedicated `explains` table keyed by `(segment_id, version)` with `(user_id, target_language, target_text_hash, version)` for cross-segment dedupe — if the same target text has been explained before, we reuse the row instead of re-generating.

We rejected caching Explain in `segments.metadata` because cross-segment reuse (same Japanese sentence appearing in two different Threads) needs a queryable target_text key, and we want versioning baked in so an Explain format change doesn't silently serve stale shape. We rejected generating Explain eagerly at translate time because the dominant case (short messages) never opens Explain — paying for it on every Segment doubles cost for no gain.

Embeddings are computed synchronously inside the Segment create path. Marginal latency is small next to the translation call itself, and self-consistent storage (every Segment has an embedding) keeps retrieval predictable. The embedding provider is owned by `api/_lib/embeddings.ts`; the 1536-dim default tracks OpenAI `text-embedding-3-small` but is a config decision, not a contract.

## Consequences

- pgvector becomes a hard runtime dependency on the database. Neon supports it; other Postgres providers must enable the extension. See [DEPLOYMENT.md](../DEPLOYMENT.md).
- A vibration in the embedding model (dimension change, provider swap) requires a rebuild of `segments.source_embedding`. Embeddings are derived data — the source_text + target_text + explain body remain the truth.
- Tier gating: **Translation memory** and **Explain** are Pro+ features. Free tier creates Segments and sees hover alignment, but the Explain button shows an upsell and there is no `/api/memory` access. See [BACKEND.md](../BACKEND.md#tiers).
- Privacy: storing all translations + explanations long-term raises retention obligations. Per-tier `retentionDays` is the soft expiry; user-driven deletion (`DELETE /api/segments/:id` cascades the embedding and any Explain rows) is the hard control. See [SECURITY.md](../SECURITY.md).
