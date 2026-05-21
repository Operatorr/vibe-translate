# PRODUCT.md

> Definitions of all bold-cased terms live in [CONTEXT.md](../CONTEXT.md).

## What Vibe Translate is

Vibe Translate is a translator for **language learners** that lets you pick the social **Register** ("**Vibe**") of the output, hover any word to see its alignment on the source side, and tap **Explain** to get a grammar-level breakdown of the result.

It is built around one frustration: when a learner translates "remind me to grab the recipe" from English to Japanese in Google Translate, they get one formal register — the wrong one for texting a friend. Vibe Translate exposes the register as a first-class control so the output sounds like a person, not a brochure.

## Target user

- People actively learning a second language, especially **Japanese** (the anchor language).
- Learners who already understand *that* register exists but can't yet calibrate it themselves.
- Travelers and friends-of-friends who need to message someone in a language they're still acquiring.

Not the target user:
- Professional translators and linguists.
- Anyone who needs one-shot, throwaway translations (Google Translate already handles that fine).

## The wedge

A **6-stop Vibe slider** on every **Segment**. Moving the slider does not restyle the text — it produces a new translation calibrated to the chosen **Register** (different word choices, particles, verb endings, prosody). Old segments remain in history.

The six stops are universal IDs (`yakuza`, `friend`, `casual`, `keigo`, `keigoplus`, `emperor`) chosen as evocative metaphors. Each target language localizes the labels and hint text — `keigoplus` is "Keigo+ · 尊敬語 honorifics, business" in Japanese, "Formel · monsieur · administratif" in French. Same canonical slot, different surface. **Team tier** can extend with custom registers; free and pro are fixed at six.

This is what nothing else does well. DeepL and Google Translate emit a fixed register. ChatGPT can be prompted to vary register but the learner has to know the metalanguage to ask. Vibe Translate makes register the primary affordance — and pins it to a concrete recipient (a **Character**) so the learner doesn't have to think about it in the abstract.

## Core capabilities

### Characters → Threads → Segments

The product is organized around three nested concepts:

- A **Character** is a persistent persona the user translates *toward* — "Oba-chan" (Osaka grandma, casual, kansai-ben), "Buchou-san" (Tokyo manager, keigo+). It pins source/target language, a default **Vibe**, a **Temperature**, and a **Persona** block (age, region, formality, traits) that feeds the model prompt.
- A **Thread** is a topic-level conversation under a Character — "Asking for grandma's recipe", "Email: Q3 release notes review".
- A **Segment** is one source→target translation inside a Thread, produced at a chosen **Vibe stop**.

Characters are the primary navigation surface. The learner thinks "I'm messaging Oba-chan", not "I'm doing a `ja-JP` translation."

### Translate with a chosen Vibe

- A **Segment**'s default Vibe inherits from its **Character**; the slider lets the learner override per-Segment.
- **Commit-to-translate:** moving the slider doesn't fire a translation on every stop — the user commits one stop and one translation runs. This protects credits (a drag across all six stops would otherwise be six spends).
- **Already-generated stops are instant and free.** A stop the user has already translated in this thread is served from history (0 credits). A *canonical* phrase someone else already translated is served from the shared **Translation cache** (0 credits). Only a genuinely new translation spends credits.
- Changing the Vibe re-runs the translation and appends to history rather than overwriting.
- **Temperature** is set per-Character (0.0–1.0). Lower for keigo / business; higher for friend / yakuza.

### Hover word alignment

- Hovering a word on either the source or target segment highlights its counterpart on the other side.
- Word-aligned spans are produced server-side as part of the translation result.

### Translation memory

Every **Segment** the user creates is embedded and stored as searchable history. `GET /api/memory?q=…` returns past Segments cosine-similar to a new query, optionally scoped to a **Character** or target language. The learner can ask *"did we already translate something like this?"* before generating a new translation. Pro+ only.

Translation memory is **the user's corpus, not transient cache** — deleted only by the user or by tier-driven retention expiry.

### Explain (pedagogical breakdown)

Tapping **Explain** on a target segment opens a structured analysis. For a Japanese target it includes:

- **Romaji** transliteration of the whole segment.
- **Literal gloss** word-by-word in the user's source language.
- **Morphemes & particles** — each token broken into base + inflection + grammatical role (verb, noun, particle, aux, punct).
- **Kanji built from** — for each kanji: ON / KUN readings, radicals, stroke count, JLPT level.
- **Grammar patterns** — short notes on each grammatical construction used, including dialect awareness (e.g. Kansai-ben `〜くれへん？` vs. standard `〜くれない？`).

Explain is **language-aware**: the schema for "what an Explain looks like" varies per target language. Japanese gets kanji + JLPT; other languages get their equivalent scaffolding.

Explain payloads are stored as **Explain memory** — one row per `(segment, version)`, deduped cross-segment by `(target_language, target_text_hash, version)`. The same Japanese sentence explained in two different threads reuses one row. Pro+ only.

### Listen at the chosen Vibe

- A **Target segment** can be played back via an ElevenLabs voice that is **locked one-to-one with the Vibe stop**. Picking `keigo` translates *and* reads back in the keigo voice; there is no separate voice control.
- Six voices, one per stop, configured via `ELEVENLABS_VOICE_<STOP>` env vars (`ELEVENLABS_VOICE_YAKUZA`, etc.). The voices are chosen for the anchor language (Japanese today) and re-selected per target language as the language pack matures.

### Onboarding (first Character)

A new user's first job is to create a **Character**. The flow is **dictation-first with a form fallback**:

1. **Dictation box with an on-screen sample.** The user describes who they're translating for in plain language — the sample shows them how (*"Help me text my friend Tomoko in Tokyo casually in Japanese"*). The model parses this into a **Character draft**: name, source/target language, default vibe, temperature, structured persona, and — most valuably — the free-form **Instructions** that extend the system prompt ("friend in Tokyo, named Tomoko").
2. **Confirmation form, pre-filled.** The draft lands in the Character form for the user to confirm or edit. This is where dictation's power shows: it shapes the Character better than blank form fields could.
3. **Fallbacks.** If the parse fails (`ok: false` — the user phrased it in a way the model couldn't turn into a config), the UI drops to an empty Character form. There's also a **Skip** button to bypass dictation and go straight to the form.

Onboarding completes when the first Character is created (`onboarding_complete = true`), regardless of path.

Why dictation-first despite the cost and failure risk: it produces a richer Character (the free-form **Instructions** especially) and demos the product's intelligence on the first screen. The sample prompt and form fallback de-risk the "user doesn't know how to phrase it" failure mode. Onboarding dictation is **free** (platform-paid, one-shot, rate-limited) — a taste of the Pro+ dictation feature.

### Persistent chats

- Chats are sorted, reorderable, and retained per **Tier**.
- A learner returns to the same chat ("messaging my host family") and continues adding translations in the same language pair and instructions context.

## Tiers and Credits

Tiers are `free`, `pro`, `team`, defined in `api/_lib/tier.ts`. The differentiator between tiers is the monthly **Credits** allowance, plus a feature flag matrix (Explain, Translation memory, AI dictation, custom Vibe stops). All tiers share the **same models** for translate, explain, and embed; the upgrade path is *more capacity*, not *better output*.

- **Free** — trial monthly credit allowance. Read-only access to past Segments stays unlimited.
- **Pro** — higher monthly allowance, unlocks Explain + Translation memory + AI dictation.
- **Team** — highest allowance, adds custom Vibe stops.

The exact gate matrix lives in [BACKEND.md](./BACKEND.md#tiers).

## BYOK (Bring Your Own Key)

Any user on any tier can store an **OpenRouter API key**. When configured, the worker calls OpenRouter with the user's key and **does not charge credits** — the user pays OpenRouter directly and can use the product as much as they like.

BYOK users can also pick their own translate/explain models (e.g. `anthropic/claude-opus-4.7`, `openai/gpt-5-pro`, etc.) by storing the OpenRouter model slug. If they don't specify, the platform defaults from the **Model registry** are used.

**BYOK never applies to embeddings.** Translation memory only works if every Segment is embedded with the same model — so the platform owns the embed call regardless of BYOK status. (Embedding cost is small compared to translation; it's bundled into Pro+ flat.)

## Out of scope (today)

- Document translation, file uploads.
- Real-time conversational interpretation.
- Collaborative editing inside a chat.
- Linguist-grade terminology management.

These are intentionally excluded — they would shift the product away from the learner.

## Open product questions

These are unresolved and tracked here until they're decided:

- Are the six universal **Vibe stop** IDs (`yakuza`…`emperor`) the right level of abstraction across every language, or do some languages need different slot semantics? (E.g. does `emperor` make sense for Korean Royal speech *and* Brazilian Portuguese "Cortês"?)
- Custom registers on **Team tier** — does a team define one extra stop or replace the palette?
- Should **Translation memory** hits be auto-injected into the model prompt (RAG-style retrieval-augmented translation) or stay user-driven (the learner clicks "Search memory" before translating)?
- Is there a public **CLI** product (the design Pricing page lists `npx vibe-translate`)? If yes, it needs its own doc.
