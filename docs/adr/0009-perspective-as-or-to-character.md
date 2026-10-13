---
status: accepted
---

# Perspective: speaking as the Character or to them

The translate prompt never said who was talking. The persona heading read "who is speaking / being addressed", and the Vibe register lines mixed the two: `keigoplus` was "deferential toward a superior" (speaking to someone), while `yakuza` ("intimidating") and `emperor` ("imperial phrasing") described the speaker. A learner who picked Emperor could not say whether they wanted to sound like an emperor or to address one. These produce opposite Japanese. An emperor speaking talks down, with imperial self-reference and commands. Someone speaking to an emperor uses the most exalted honorifics and humbles themselves. Yakuza splits the same way: rough street talk when speaking as one, careful respect when speaking to one.

We added **Perspective**, a two-value choice (`as` | `to`) that is part of every translation:

- **`as`**: the source text is the Character's own words. The translation is in their voice. The register line describes how they talk, and the Persona describes the speaker.
- **`to`**: the source text is the user's own words, addressed to the Character. The register line describes how to address someone like them, and the Persona describes the listener. The model is told never to borrow the Character's self-reference, attitude or status. The listener's region still selects the variety the user writes in, as it did before. That keeps Kansai-ben to an Osaka grandmother, and written Cantonese to a Hong Kong contact.

Register guidance is now `Record<VibeStop, Record<Perspective, string>>`, one line per stop and perspective. The middle stops (friend, casual, keigo) mostly converge. The extremes diverge sharply.

## Where it lives

- **Character default** (`characters.perspective`, not null, default `to`). A Character is someone the user writes to (CONTEXT.md), so existing Characters default to `to`. The composer's radio and the Character panel both write this field. The radio saves on change, like temperature, so the next visit opens with the same choice.
- **Per-request** (`POST /api/segments` → `perspective?`). The client always sends what the radio shows. A save still in flight therefore cannot change the translation. Omitting it means the Character's default, the same rule as `vibe`.
- **Segment snapshot** (`segments.perspective`, nullable). The same rule as the Vibe snapshot ([ADR 0007](./0007-segment-vibe-snapshot.md)). The resolved perspective is stored with the target text, and Retry reuses it. Rows created before this change stay null: they came from the ambiguous prompt, and labelling them either way would misdescribe them. Retry on such a row resolves the Character's current perspective and records it. The UI shows no perspective tag for null.

## Consequences

- **Dedupe** matches `(thread, source_text, vibe, perspective)`. An `as` translation never answers a `to` request. Legacy null rows never match, so the first request after this change makes a new translation.
- **Shared cache**: the fingerprint gains `perspective`, and `TRANSLATE_PROMPT_REVISION` goes to 3 because the canonical prompt changed. Earlier entries are orphaned, not served, and age out by `last_used_at`. Canonical translations still require an empty persona and instructions plus the default temperature. Perspective is not personalization. It is a key dimension, like `vibe`, so both perspectives stay cacheable.
- **Behaviour change for existing Characters**: with the default `to`, the Emperor and Yakuza stops now address that kind of person rather than impersonate them. Learners who relied on the old impersonating output switch the radio to "As the speaker".
- Dictation may infer a perspective ("I want to sound like a yakuza" → `as`). The Character form confirms it.

We rejected deriving perspective from the stop (for example, "emperor always means speaking as"). Both directions are legitimate learning goals at every stop, and hiding the choice was the original bug. We also rejected a third "neutral" value: the model has to pick a speaker either way.
