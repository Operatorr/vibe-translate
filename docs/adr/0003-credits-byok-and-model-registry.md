---
status: accepted
---

# Credits, BYOK, and a model registry as data

Model selection is **data, not config**: a `models` table holds one default row per task (`translate`, `explain`, `embed`). Initial defaults are `deepseek/deepseek-v4-pro` (translate), `xiaomi/mimo-v2.5-pro` (explain), `openai/text-embedding-3-large` (embed, 3072 dims). The worker resolves the active model at request time. Operators can flip defaults with a single SQL update; no deploy required.

The same task uses the same model for all paying and free tiers. The differentiator between tiers is **credits**, not model strength. Free users get a monthly trial allowance; Pro users get a higher monthly allowance; Team users get the highest. Every Segment created and Explain generated debits the user's `credits_balance` based on token usage × per-model `credit_cost_multiplier`. A `credit_ledger` table records every grant and every spend for audit and billing transparency.

**Bring-Your-Own-Key (BYOK)** is available to all tiers. A user can store their own OpenRouter API key (encrypted at rest via AES-GCM with `CREDENTIALS_ENCRYPTION_KEY`) and optionally pick their own translate/explain models. When BYOK is configured, the worker calls OpenRouter with the user's key and skips credit accounting — the user pays OpenRouter directly. BYOK does **not** apply to embeddings: translation memory consistency requires every Segment to be embedded with the same model, so the platform owns the embedding call regardless of BYOK status.

We rejected hardcoding model IDs in env vars or `tier.ts` because operators need to test model swaps (and roll back) without a deploy. We rejected tier-tiered model selection because it makes the free → pro upgrade story about quality drift rather than capacity, which is harder to explain. We rejected allowing BYOK for embeddings because mixing embeddings from different providers in one `segments.source_embedding` column breaks cosine search (vectors aren't comparable across models or dimensions).

## Consequences

- Embedding dimension changes from 1536 to 3072. `segments.source_embedding` is `vector(3072)`. A future embedding-model change requires re-embedding every row — embeddings remain derived data.
- Free tier loses the `segmentsPerMonth` cap in favor of a `credits` cap. Calling it "trial" in the marketing copy is fine; the implementation is monthly-refilled credits (cleaner than one-shot trial logic).
- The `users` table grows wider: `credits_balance`, `credits_refilled_at`, `openrouter_api_key_cipher`, `openrouter_api_key_last4`, `byok_translate_model_id`, `byok_explain_model_id`.
- Worker requires `CREDENTIALS_ENCRYPTION_KEY` in the binding set. Rotating it requires re-encrypting all stored BYOK keys; see [SECURITY.md](../SECURITY.md).
- The BYOK code path skips credit checks. Defensive: if `users.openrouter_api_key_cipher` is non-null, we trust the BYOK path. If decryption fails, fall back to the platform path (don't 500 the request).
