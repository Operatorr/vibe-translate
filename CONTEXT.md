# Vibe Translate

A language-learning translator that lets the user pick the social **register** ("vibe") of a translation, hear it in a voice that matches, and drill into the grammar and morphology behind it. Japanese is the anchor language.

## Language

### Product

**Vibe**:
The user-facing name for the chosen social **Register** of a translation, picked from a fixed 6-stop slider. The 6 canonical stop IDs are `yakuza`, `friend`, `casual`, `keigo`, `keigoplus`, `emperor` — chosen as evocative brand metaphors. Each stop carries a language-specific label (e.g. `keigoplus` → "Keigo+" in `ja-JP`, "Formel" in `fr-FR`, "Formal" in `en-US`).
_Avoid_: tone, style, mood, register slot

**Register**:
The linguistic concept underneath **Vibe** — formality, dialect, social distance — that determines word choice, particles, verb endings, and prosody.
_Avoid_: formality (too narrow), politeness level (too narrow)

**Vibe stop**:
One of the six discrete positions on the **Vibe** slider. Same six IDs across all languages; labels and hint phrases are localized per target language.
_Avoid_: vibe preset (overloaded with the per-language preset table)

**Vibe preset table**:
The per-target-language mapping from **Vibe stop** ID to localized label, hint, and color. Lives in design data today (`Vibe_Translate_App_Design/js/data.js → VIBE_PRESETS_PER_LANG`).
_Avoid_: vibe map, presets

**Character**:
A persistent persona the user translates *toward* — name, source/target language pair, default **Vibe**, temperature, and **Persona** attributes (age, region, formality, traits). Functions like a contact. Examples: "Oba-chan" (Osaka grandma, casual, kansai-ben), "Buchou-san" (Tokyo manager, keigo+).
_Avoid_: contact, profile, persona (the inner attribute), recipient

**Persona**:
The *structured* attribute block on a **Character** — age, region, formality, free-form trait list. Drives the UI chips and the deterministic onboarding form.
_Avoid_: traits, profile

**Instructions**:
The *free-form* natural-language extension appended to a **Character**'s system prompt at translate time ("his name is Kenji, your college roommate, uses Kansai-ben"). Complements the structured **Persona** — Persona is fields, Instructions is prose. Populated by dictation onboarding or hand-edited.
_Avoid_: notes, prompt, system prompt (that is the whole assembled prompt, not this fragment)

**Onboarding**:
The first-signin flow that produces the user's first **Character**. Dictation-first (a free-form description parsed into a draft) with a fallback to the **Character form**. Completes when the first Character is created (`users.onboarding_complete = true`).
_Avoid_: setup, signup (signup is the Clerk auth step, distinct)

**Dictation**:
Parsing a free-form spoken/typed description into a **Character draft**. Free and one-shot during **Onboarding**; a Pro+ feature for spinning up further Characters in-app. Uses the `dictation` **Model registry** task.
_Avoid_: voice input (dictation is the parse, not the speech-to-text)

**Thread**:
A topic-level conversation under a **Character**. Has a title and many **Segments**. Example: "Asking for grandma's recipe".
_Avoid_: chat, conversation, room

**Segment**:
A single source-text → target-text translation inside a **Thread**, produced at one **Vibe**. Carries word-aligned tokens (each target token mapped to its source span) and a token-cost count.
_Avoid_: translation (the DB table name today), message, turn

**Source segment / Target segment**:
The source-text side and target-text side of one **Segment**, word-aligned so the user can hover a word on one side and see its counterpart on the other.
_Avoid_: source/target string, input/output

**Temperature** (per-Character):
A 0.0–1.0 model creativity setting stored on the **Character**. Lower = more literal/consistent (business, formal); higher = more playful/varied (friends, intimate).
_Avoid_: creativity, variance — `temperature` is the canonical name (matches the LLM API term).

**Explain**:
The pedagogical breakdown of a **Target segment** — romaji, literal gloss, morphemes and particles, kanji decomposition (radicals, readings, stroke count, JLPT level), and grammar patterns. Triggered by an Explain button on the target side.
_Avoid_: analysis, breakdown, deep-dive

**Tier**:
The user's subscription level — `free`, `pro`, or `team` — granting a monthly **Credits** allowance and unlocking feature flags. Defined in `api/_lib/tier.ts`. **Translation memory** and **Explain** are Pro+ features.
_Avoid_: plan (used only at billing checkout), subscription level

**Credits**:
The platform-key budget unit. Spent on every **Segment** create and **Explain** generate (token-derived × per-model multiplier). Granted monthly per **Tier**. Free tier's monthly grant is the trial allowance. Stored on `users.credits_balance`; every spend and grant is recorded in `credit_ledger`. **BYOK** users bypass credits.
_Avoid_: tokens (confusable with model tokens), quota, allowance

**BYOK** (Bring Your Own Key):
Per-user OpenRouter API key stored encrypted at rest (AES-GCM). When configured, the worker calls OpenRouter with the user's key and **skips credit accounting** — the user pays OpenRouter directly. Available on all tiers. Applies to **Translate** and **Explain** only; never to **Embedding**.
_Avoid_: own key, custom key

**Model registry**:
The `models` table — the system of record for which model serves which **Task** (translate, explain, embed). One default row per task; operators flip defaults with a single SQL update. **BYOK** users may override their translate/explain model; the embed model is fixed.
_Avoid_: model config, model table

**Translation memory**:
The user's accumulated **Segments** treated as a searchable corpus. Each Segment carries an embedding of its source text, and `GET /api/memory?q=…` returns top-K cosine-similar past Segments. Lets a learner answer *"did we already translate something like this?"*. Pro+ only.
_Avoid_: TM (full term in docs), search history, corpus

**Explain memory**:
The persistent store of generated **Explain** payloads — one row per `(segment, version)`, deduped cross-segment via `(target_language, target_text_hash, version)`. Same Japanese sentence explained twice reuses one row. Pro+ only.
_Avoid_: explain cache (it is not a cache — it is the system of record)

**Embedding**:
The vector representation of a Segment's source text used for retrieval. 1536 dimensions today (matching OpenAI `text-embedding-3-small`); the dimension is fixed in the DB column `segments.source_embedding vector(1536)`. Derived data — re-buildable from `source_text`.
_Avoid_: vector (overloaded with the SQL type), encoding

**Memory hit**:
A single result row from a **Translation memory** search — a past Segment with its cosine-similarity score against the user's query.
_Avoid_: match, result

**Translation cache**:
A *shared, cross-user* store of **canonical** translations (no persona, no instructions, default temperature), keyed by an exact fingerprint of `(source_text, source_lang, target_lang, vibe, model_id)`. A cache hit returns instantly and costs **0 credits**. Distinct from **Translation memory**: the cache is exact-match and global; memory is semantic and per-user. Privacy-safe — you only hit on inputs you supplied yourself.
_Avoid_: translation memory (different mechanism), shared memory

**Canonical translation**:
A translation produced with empty **Persona**, empty **Instructions**, and default **Temperature** — the only kind eligible for the shared **Translation cache**. Personalized translations are per-user only.
_Avoid_: default translation, vanilla

### Voices

**Voice persona**:
The ElevenLabs voice that reads back a **Target segment**. **Locked one-to-one with the Vibe stop** — six voices total, picked by matching ID. There is no separate user-facing voice control. Voice IDs are configured per-deployment via `ELEVENLABS_VOICE_<STOP>` env vars.
_Avoid_: vibe (use **Vibe stop** when referring to the slider value), speaker, voice ID (an implementation detail)

## Relationships

- A **User** owns many **Characters**; a **Character** owns many **Threads**; a **Thread** holds many **Segments**.
- A **Character** pins one source language, one target language, a default **Vibe**, a **Temperature**, and a **Persona**. A **Thread** inherits these but a **Segment** can override the **Vibe**.
- A **Segment** is produced at exactly one **Vibe stop**; the same source text at a different stop is a new **Segment**.
- A **Target segment** can be played back through any configured **Voice persona** and expanded into an **Explain** view.
- A **Tier** gates which **Voice personas**, retention windows, custom **Vibe stops**, and AI features are available.

- A **Segment** has at most one current **Explain** payload per `version`; bumping the global `EXPLAIN_PAYLOAD_VERSION` invalidates older rows (which are then re-generated on next read).
- A **Segment** has at most one `source_embedding`; if absent, the Segment is invisible to **Translation memory** search until backfilled.

## Example dialogue

> **Dev:** "When a user moves the **Vibe** slider on a **Segment**, do we re-fetch or re-render?"
> **Domain expert:** "Re-fetch. Changing the **Register** rewrites word choice, particles, and verb endings — it's a new **Segment**, not a styling tweak. The old one stays in history."

> **Dev:** "Is the **Vibe** picked per-Character or per-Segment?"
> **Domain expert:** "Per-Character is the default; per-Segment can override. The learner messages Oba-chan in casual but might draft one segment in keigo when she's mad at them."

> **Dev:** "Are the six **Vibe stop** IDs the same across languages?"
> **Domain expert:** "Yes, IDs are universal — only the labels and hints are localized. `keigoplus` in Japanese is keigo with sonkeigo; in French it's `Formel`. Same slot, different surface."

## Flagged ambiguities

- **"vibe"** is one concept with two surfaces: it drives both translation register *and* TTS voice selection. The slider value (a **Vibe stop**) is the single input; **Voice persona** is downstream and never independently chosen. The two terms are kept distinct in this glossary because they describe different *effects* (text vs audio), not different *inputs*.
- **"memory"** is overloaded between **Translation memory** (cross-Segment retrieval over source_embedding) and **Explain memory** (per-target-text Explain reuse). They share a name because both are user-data-as-corpus, but the access patterns differ — TM is embedding similarity, Explain memory is hash equality on `target_text`.
- **"cache"** is *not* used for Explain memory. Both Translation memory and Explain memory are first-class persistent stores; "cache" would imply they are disposable, which they are not.
