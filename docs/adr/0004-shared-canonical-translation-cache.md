---
status: accepted
---

# Shared canonical translation cache

A global `translation_cache` table lets identical translation requests across users reuse a prior result — instant and **free** (zero credits, zero model call). It is keyed by a SHA-256 **fingerprint** of `(source_text, source_language, target_language, vibe, model_id)` and stores only `target_text`, `token_alignment`, and `source_embedding`. It carries **no `user_id`, no persona, no instructions**.

Only **canonical** translations are cached globally: those produced with an empty persona, empty instructions, and the default temperature. Personalized translations (any persona, any instructions, non-default temperature) are saved as per-user **Segments** but are never written to the shared cache.

This is privacy-safe by construction: a requester only ever gets a cache hit on inputs they fully supplied themselves. The cache is a memoized pure function `f(source, langs, vibe, model) → (target, alignment)`. Nothing about another user's private content can be learned from it — the source text is supplied by the requester, and personalization (which is where private context lives) is excluded from caching entirely.

We rejected sharing the per-user **Translation memory** directly because those Segments carry persona, instructions, and user attribution — serving one user's personalized output to another would be both a privacy leak and a correctness bug (the same source at the same vibe yields different output under different personas). We rejected including persona/instructions in the fingerprint (which would make personalized results technically cacheable) because storing the resulting target text globally still risks leaking persona-derived phrasing, and the reuse rate for personalized inputs is near zero anyway.

## Consequences

- Translate flow gains two pre-checks before any model call: (1) in-thread Segment for `(thread, source_text, vibe)`, (2) global `translation_cache` fingerprint lookup (canonical requests only). Both yield 0-credit, instant results.
- On a cache miss for a canonical request: translate, write the Segment, and upsert the cache (storing `source_embedding` so future hits copy it without re-embedding).
- The cache is derived data — safe to truncate and rebuild. `hits` / `last_used_at` support eviction later if it grows.
- Per-user **Translation memory** (semantic embedding search) and the shared **translation cache** (exact fingerprint match) are distinct mechanisms with distinct privacy properties — see [CONTEXT.md](../CONTEXT.md).
