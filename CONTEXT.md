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
A persistent persona the user translates _toward_ — name, source/target language pair, default **Vibe**, **Perspective**, temperature, and **Persona** attributes (age, region, formality, traits). Functions like a contact. Examples: "Oba-chan" (Osaka grandma, casual, kansai-ben), "Buchou-san" (Tokyo manager, keigo+). With **Perspective** `as`, the user speaks in the Character's voice instead of to them.
_Avoid_: contact, profile, persona (the inner attribute), recipient

**Perspective**:
Whether the user speaks **as** the **Character** (the translation is the Character's own words, in their voice) or **to** them (the user's own words, addressed to the Character). It flips how the **Vibe stop** and **Persona** are read. Speaking as an emperor talks down with imperial self-reference; speaking to one uses the most exalted honorifics. Stored as the Character's default (`to` unless changed), chosen per translation in the composer, and recorded on each **Segment**. UI labels: "As the speaker" / "To the speaker". See [adr/0009](./docs/adr/0009-perspective-as-or-to-character.md).
_Avoid_: direction, mode, role, voice (that is the **Voice persona**)

**Persona**:
The _structured_ attribute block on a **Character** — age, region, formality, tone, verbosity (0–1), free-form trait list. Drives the UI chips and the deterministic onboarding form. Describes the speaker under **Perspective** `as` and the person being addressed under `to`. Region selects the variety written in either way.
_Avoid_: traits, profile

**Instructions**:
The _free-form_ natural-language extension appended to a **Character**'s system prompt at translate time ("his name is Kenji, your college roommate, uses Kansai-ben"). Complements the structured **Persona** — Persona is fields, Instructions is prose. Populated by dictation onboarding or hand-edited.
_Avoid_: notes, prompt, system prompt (that is the whole assembled prompt, not this fragment)

**Onboarding**:
The first-signin flow that produces the user's first **Character**. Dictation-first (a free-form description parsed into a draft) with a fallback to the **Character form**. Completes when the first Character is created (`users.onboarding_complete = true`).
_Avoid_: setup, signup (signup is the account-creation auth step, distinct)

**Dictation**:
Parsing a free-form spoken/typed description into a **Character draft**. Free and one-shot during **Onboarding**; a Pro+ feature for spinning up further Characters in-app. Uses the `dictation` **Model registry** task.
_Avoid_: voice input (dictation is the parse, not the speech-to-text)

**Thread**:
A topic-level conversation under a **Character**. Has a title and many **Segments**; can be **starred** (pinned in the sidebar) and **shared** via a **Share link**. Example: "Asking for grandma's recipe".
_Avoid_: chat, conversation, room

**Share link**:
A read-only public URL (`/share/<token>`) for one **Thread**. The token is the capability — anyone holding it can read the thread without an account; the owner can revoke it. At most one live link per Thread.
_Avoid_: public thread, export link (export is the Markdown download)

**Retry**:
Re-running the translation of an existing **Segment**, replacing the target in place. The user confirms a **Vibe stop** first: the stored one (a fresh sample) or a different one (the same row re-translated in another **Register**). The stored **Perspective** is always kept. Not a new Segment — it skips dedupe and the **Translation cache**.
_Avoid_: regenerate, re-translate (in code)

**Segment**:
A single source-text → target-text translation inside a **Thread**, produced at one **Vibe** and one **Perspective**. Carries word-aligned tokens (each target token mapped to its source span) and a token-cost count.
_Avoid_: translation (the DB table name today), message, turn

**Source segment / Target segment**:
The source-text side and target-text side of one **Segment**, word-aligned so the user can hover a word on one side and see its counterpart on the other.
_Avoid_: source/target string, input/output

**Temperature** (per-Character):
A 0.0–1.0 model sampling setting stored on the **Character**. Lower = more predictable wording; higher = more varied phrasing. It does not set politeness, length, or meaning: **Vibe** controls the register, and **Persona** verbosity controls phrasing length. Identical wording is not guaranteed even at zero; stored/cache hits may reuse the same result.
_Avoid_: creativity, variance — `temperature` is the canonical name (matches the LLM API term).

**Explain**:
The pedagogical breakdown of a **Target segment** — romaji, literal gloss, morphemes and particles, kanji decomposition (radicals, readings, stroke count, JLPT level), and grammar patterns. Triggered by an Explain button on the target side.
_Avoid_: analysis, breakdown, deep-dive

**Tier**:
The user's subscription level — `free`, `pro`, or `team` — granting a monthly **Credits** allowance and unlocking feature flags. Defined in `api/_lib/tier.ts`. **Translation memory** and **Explain** are Pro+ features.
_Avoid_: plan (used only at billing checkout), subscription level

**Credits**:
The platform-key budget unit. Spent on every **Segment** create and **Explain** generate (token-derived × per-model multiplier). Granted once on signup for Free (10,000 welcome credits), on billing renewal for paid **Tiers**, or bought as one-time top-up packs. A fully refunded or charged-back top-up is reversed in full, which can leave the balance negative until later grants cover it. Stored on `users.credits_balance`; every spend and grant is recorded in `credit_ledger`. **BYOK** users bypass credits.
_Avoid_: tokens (confusable with model tokens), quota, allowance

**BYOK** (Bring Your Own Key):
Per-user OpenRouter API key stored encrypted at rest (AES-GCM). When configured, the worker calls OpenRouter with the user's key and **skips credit accounting** — the user pays OpenRouter directly. Available on all tiers. Applies to **Translate** and **Explain** only; never to **Embedding**.
_Avoid_: own key, custom key

**Model registry**:
The `models` table — the system of record for which model serves which **Task** (translate, explain, embed). One default row per task; operators flip defaults with a single SQL update. **BYOK** users may override their translate/explain model; the embed model is fixed.
_Avoid_: model config, model table

**Translation memory**:
The user's accumulated **Segments** treated as a searchable corpus. Each Segment carries an embedding of its source text, and `GET /api/memory?q=…` returns top-K cosine-similar past Segments. Lets a learner answer _"did we already translate something like this?"_. Pro+ only.
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
A _shared, cross-user_ store of **canonical** translations (no persona — tone and verbosity included — no instructions, default temperature), keyed by an exact fingerprint of `(source_text, source_lang, target_lang, vibe, perspective, model_id, prompt_revision)`. A cache hit returns instantly and costs **0 credits**. Distinct from **Translation memory**: the cache is exact-match and global; memory is semantic and per-user. Privacy-safe — you only hit on inputs you supplied yourself.
_Avoid_: translation memory (different mechanism), shared memory

**Canonical translation**:
A translation produced with empty **Persona** (every field, including the voice fields tone and verbosity), empty **Instructions**, and default **Temperature** — the only kind eligible for the shared **Translation cache**. Personalized translations are per-user only.
_Avoid_: default translation, vanilla

### Identity

**User**:
The signed-in person. Identity (email, password hash, Google link, **Sessions**) lives in Better Auth's `auth_*` tables. The app-side `users` row (tier, **Credits**, **BYOK**, onboarding) is keyed by `auth_user_id` and created on the first authenticated request. Deleting the identity cascades through all of the User's data.
_Avoid_: customer (billing context only), member, account (Better Auth's `auth_accounts` are sign-in methods, not users)

**Session**:
A signed-in browser, carried by an httpOnly same-origin cookie, never a token in JS. Expiry slides over 30 days, so a User who visits daily stays signed in, and 30 idle days end it.
_Avoid_: token, login

### Voices

**Voice persona**:
The ElevenLabs voice that reads back a **Target segment**. **Locked one-to-one with the Vibe stop** — six voices total, picked by matching ID. There is no separate user-facing voice control. Voice IDs are configured per-deployment via `ELEVENLABS_VOICE_<STOP>` env vars. Pro+ and Japanese targets only today; everyone else gets **Browser voice**.

**Browser voice**:
The free fallback read-back engine — the browser's built-in speech synthesis (`app/lib/tts.ts`), with per-**Vibe stop** rate/pitch so the six stops still sound distinct. Used on the free tier, for non-Japanese targets, on the public **Share link** page, and whenever ElevenLabs fails.
_Avoid_: vibe (use **Vibe stop** when referring to the slider value), speaker, voice ID (an implementation detail)

## Relationships

- A **User** owns many **Characters**; a **Character** owns many **Threads**; a **Thread** holds many **Segments**.
- A **Character** pins one source language, one target language, a default **Vibe**, a **Perspective**, a **Temperature**, and a **Persona**. A **Thread** inherits these but a **Segment** can override the **Vibe** and the **Perspective**.
- A **Segment** is produced at exactly one **Vibe stop** and one **Perspective**. Sending the same source text at a different stop or perspective creates a new **Segment**; a **Retry** at a different stop rewrites that Segment's target and stop in place.
- A **Segment** can be deleted on its own; the **Thread** and its other Segments stay.
- A **Target segment** can be played back through any configured **Voice persona** and expanded into an **Explain** view.
- A **Tier** gates which **Voice personas**, retention windows, custom **Vibe stops**, and AI features are available.

- A **Segment** has at most one current **Explain** payload per `version`; bumping the global `EXPLAIN_PAYLOAD_VERSION` invalidates older rows (which are then re-generated on next read).
- A **Segment** has at most one `source_embedding`; if absent, the Segment is invisible to **Translation memory** search until backfilled.

## Example dialogue

> **Dev:** "When a user moves the **Vibe** slider on a **Segment**, do we re-fetch or re-render?"
> **Domain expert:** "Re-fetch. Changing the **Register** rewrites word choice, particles, and verb endings — it's a new translation, not a styling tweak. From the composer it's a new **Segment** and the old one stays in history; from **Retry** it replaces that Segment's target."

> **Dev:** "Is the **Vibe** picked per-Character or per-Segment?"
> **Domain expert:** "Per-Character is the default; per-Segment can override. The learner messages Oba-chan in casual but might draft one segment in keigo when she's mad at them."

> **Dev:** "The learner picked Emperor. Do we make them sound like an emperor?"
> **Domain expert:** "Check the **Perspective**. _As_ the emperor, they talk down with imperial self-reference. _To_ the emperor, they bow with the most exalted honorifics. Same stop, opposite Japanese, so we never guess. The radio sets it and the **Segment** records it."

> **Dev:** "Are the six **Vibe stop** IDs the same across languages?"
> **Domain expert:** "Yes, IDs are universal — only the labels and hints are localized. `keigoplus` in Japanese is keigo with sonkeigo; in French it's `Formel`. Same slot, different surface."

## Flagged ambiguities

- **"vibe"** is one concept with two surfaces: it drives both translation register _and_ TTS voice selection. The slider value (a **Vibe stop**) is the single input; **Voice persona** is downstream and never independently chosen. The two terms are kept distinct in this glossary because they describe different _effects_ (text vs audio), not different _inputs_.
- **"speaker"** in the UI labels ("As the speaker" / "To the speaker") means the **Character**, not the user. Under `to` the Character is really the listener; the labels name the Character's role in the user's mind, and the prompt says "the character" throughout.
- **"memory"** is overloaded between **Translation memory** (cross-Segment retrieval over source_embedding) and **Explain memory** (per-target-text Explain reuse). They share a name because both are user-data-as-corpus, but the access patterns differ — TM is embedding similarity, Explain memory is hash equality on `target_text`.
- **"cache"** is _not_ used for Explain memory. Both Translation memory and Explain memory are first-class persistent stores; "cache" would imply they are disposable, which they are not.
