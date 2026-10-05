---
status: accepted
---

# Store the generation-time Vibe on each Segment

A Segment's target text was generated at one Vibe stop. Resolving a stored null against the Character's current default relabels that text after a default change, even though no new translation occurred. It also lets in-thread dedupe reuse the old text when an omitted-vibe request now resolves to a different stop.

New Segment creates resolve an omitted `vibe` from the Character once and persist that stop in `segments.vibe`, including shared-cache hits. Dedupe uses that resolved stop. Retry uses the stored stop; for a legacy null row it resolves the current default and records the stop alongside the new target text.

The column stays nullable for existing data. A legacy null means the original stop was not recorded; private cards, public shares, and Markdown exports show "Vibe not recorded" rather than guessing from the current default. Playback uses the casual prosody fallback for these rows. We cannot reliably reconstruct historical defaults, so there is no fabricated backfill and no schema migration.

This supersedes the retroactive-inheritance consequence in [ADR 0001](./0001-character-thread-segment-model.md). The six stop IDs and API input schema are unchanged: omitting the request field still selects the Character's default for that translation.
