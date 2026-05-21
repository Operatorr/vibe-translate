---
status: accepted
---

# Character → Thread → Segment as the core domain model

The translation surface is modelled as three nested concepts — **Character** (a persistent persona with default vibe, temperature, persona attributes), **Thread** (a topic-level conversation under a character), **Segment** (one source→target translation with a 6-stop vibe choice and per-token alignment).

We rejected collapsing Character into Thread (a single "chat" with embedded persona) because the learner's mental model is *"I'm messaging Oba-chan"*, not *"I'm doing a `ja-JP` translation"*. Holding Character constant while topics change is the whole point of the product. Threads under one Character share language pair, default vibe, temperature, and persona prompt — duplicating that on every "chat" would invite drift and break the recipient-anchored mental model. Collapsing also makes the **Vibe slider** ambiguous: today the slider overrides a default that lives on the Character; without Character, the slider has no default to reference.

We rejected keeping the flat `chats`/`translations` schema as-is because the design prototype (`Vibe_Translate_App_Design/`) is detailed enough — six worked examples, threads-per-character, per-character `temp`, persona traits — that it is the target product, not exploration. The April schema simply hadn't caught up.

## Consequences

- Per-Segment vibe override semantics — `segments.vibe = null` means *inherit `characters.default_vibe`*. Renderers must resolve this before display.
- Tier limits become two-dimensional: characters per user *and* threads per character. See [BACKEND.md](../BACKEND.md#tiers).
- Custom vibe stops on Team tier (see [PRODUCT.md](../PRODUCT.md#the-wedge)) extend the canonical six but do not change the universal-ID model; per-team custom stops will live in a separate table when they ship.
