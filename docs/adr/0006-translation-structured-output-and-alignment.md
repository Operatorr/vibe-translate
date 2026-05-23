---
status: accepted
---

# Translation structured output, token alignment, and best-effort embedding

A **Segment** needs three things from one user action: the target translation, a per-token **alignment** map that powers hover-to-align, and (for Translation memory) a source **embedding**. This records how the translate flow produces them reliably.

## One model call returns translation *and* alignment

`translateSegment` makes a **single** OpenRouter call (via `openrouter.ts → chatJson`) that returns a strict `json_schema` object `{ targetText, tokens: [{ t, src }] }` — the translation and its word-level alignment together. We rejected a second, dedicated word-alignment call (or a separate alignment model): it doubles latency and cost on a synchronous request, and an aligner that didn't produce the translation has no privileged view of why each target token was chosen. `chatJson` enforces the shape with a Zod-derived `json_schema` (`strict: true`, `provider.require_parameters` so only providers that honour it are routed) and does **one corrective retry** on malformed/invalid JSON before failing 502.

## The reconstruction invariant, and degrade-to-single-token

Alignment is only useful to the UI if the tokens *are* the target text: concatenating every `t` in order must reproduce `targetText` exactly (spaces and punctuation included). A JSON schema cannot express this join-equality, so `ai.ts → finalizeTokens` checks it after validation.

When the model's tokens do **not** reconstruct the target, we **degrade to a single whole-string token** `[{ t: targetText, src: sourceText }]` rather than retry or fail. A valid translation is never discarded over imperfect alignment — the translation is the core value; hover-alignment is an enhancement that simply falls back to highlighting the whole span. We rejected a corrective retry (doubles latency/cost for a non-essential feature) and a hard failure (throws away a good, paid-for translation). An empty/whitespace `targetText` is the one case treated as a provider error (502), since there is no usable translation to keep.

## Embedding is best-effort

After a successful translation, the source text is embedded (platform key, never BYOK — see [adr/0003](0003-credits-byok-and-model-registry.md)) so the Segment joins Translation memory ([adr/0002](0002-translation-and-explain-memory.md)). This embedding is **best-effort**: if it fails — provider down, or a BYOK-only deployment with no platform `OPENROUTER_API_KEY` — the route logs `segment.embed_failed`, stores `source_embedding = null`, and still returns the Segment. We rejected making embedding mandatory: it would let an embedding outage discard an already-generated, paid-for translation, and would break BYOK-only deployments outright. A null-embedding Segment is simply excluded from semantic search until a backfill re-embeds it; the column is nullable by design.

## Consequences

- `translateSegment(input, config)` returns `{ targetText, tokenAlignment, tokenUsage }`; alignment always reconstructs the target (degraded if necessary), so the hover-to-align UI can trust it.
- A Segment may have `source_embedding = null`; Translation memory queries must tolerate (and a backfill job should repopulate) such rows.
- `finalizeTokens` and the prompt builders in `prompts.ts` are pure and unit-tested without network; the OpenRouter call is exercised via a mocked client.
- Prompt construction (register guidance, persona, the alignment hard-rules, the one-shot example) lives in `prompts.ts`; `ai.ts` owns only the call + `finalizeTokens`. See [BACKEND.md](../BACKEND.md).
