# DESIGN.md

> Component/layout implementation is in [FRONTEND.md](./FRONTEND.md). Product rationale for the interactions below is in [PRODUCT.md](./PRODUCT.md). Domain terms in [../CONTEXT.md](../CONTEXT.md).

## Design system

- **Tailwind CSS v4** via `@tailwindcss/vite`. Theme tokens are declared in `app/styles/app.css` under `@theme`, mapping semantic names (`--color-background`, `--color-panel`, `--color-accent`, …) onto a raw palette.
- **Dark-default, with a light theme.** Themes switch on `[data-theme='dark']` / `[data-theme='light']` at the document root. Dark is the primary, designed-first surface.
- **Radix primitives** for accessible interactive components, composed with `class-variance-authority` (variants), `tailwind-merge` + `clsx` (class composition), and `lucide-react` icons.
- **Framer Motion** for animation; local helpers in `app/lib/animation.ts`.

### Palette gotcha

The repo overloads Tailwind size tokens (e.g. `2xl`, `3xl`). **Use explicit widths** like `max-w-[42rem]` instead of `max-w-2xl` / `max-w-3xl`, which resolve to non-standard values here.

## The Vibe color ramp

The six **Vibe stops** have fixed brand colors forming a rough "heat" ramp from rough/intimate to formal/ceremonial. These come from the raw palette in `app.css` and the `VIBE_PRESETS_PER_LANG` table:

| stop | token | hex |
| --- | --- | --- |
| yakuza | `--red-400` | `#ff2e2e` |
| friend | `--orange-400` | `#ff5722` |
| casual | `--amber-400` | `#ff8a00` |
| keigo | `--turq-400` | `#10c594` |
| keigoplus | `--cyan-400` | `#00a8ff` |
| emperor | `--magenta-400` | `#ff1f9d` |

The color is consistent across all languages; only the **labels** localize (`keigoplus` → "Keigo+" in `ja-JP`, "Formel" in `fr-FR`).

## Key interactions

### The Vibe slider {#the-vibe-slider}

- A **6-stop discrete slider**, color-coded per the ramp above. Stops are selectable by click, drag, or keyboard (arrow keys move between stops).
- **Commit-to-translate**, not translate-on-move: sliding previews the selection but does not fire a translation on every stop. The user commits one stop → one translation runs. This is a deliberate cost guard (see [PRODUCT.md](./PRODUCT.md#the-wedge) and [adr/0004](./adr/0004-shared-canonical-translation-cache.md)).
- **Generated vs. ungenerated stops are visually distinct.** A stop already translated for this source text shows as a **filled dot** (tapping it is instant + free — served from history or the shared cache). An ungenerated stop shows as a **hollow dot** with a subtle "1 translation" cost hint; committing it spends credits (unless BYOK).

### Hover-to-align

- Hovering a word on the **source** or **target** side highlights its counterpart on the other side, using the per-token `token_alignment` map (`{ t, src }` pairs).
- **Touch fallback:** there is no hover on touch devices, so the alignment is triggered by **tap** instead. Tapping a token highlights its pair; tapping elsewhere clears.

### Explain panel

- **Explain** opens as a **side panel**, not a modal — the translation stays visible alongside the breakdown so the learner can cross-reference.
- The panel renders the language-aware payload: romaji, literal gloss, morphemes & particles (color-coded by part of speech), kanji decomposition (radicals, readings, JLPT, stroke count), and grammar patterns with dialect notes.

## Layout

- **CAT-tool surface, not a chat wrapper.** Source on the left, target on the right; past **Segments** in a thread collapse to compact pills above the active one. This is a deliberate departure from chat-bubble UIs — the product is for reviewing and learning from translations, not conversing.
- The authenticated shell (`app/routes/app/`) holds a persistent header, a **Character** sidebar, the active thread workspace, and overlays (quick-find, Explain panel).

## Accessibility baseline

- Color is never the sole signal — vibe stops pair color with labels; generated/ungenerated dots pair color with fill state.
- Radix primitives carry focus management and ARIA semantics; keep them rather than hand-rolling dialogs/menus.
- Keyboard: the vibe slider, quick-find (`⌘K`), and panel close are all keyboard-operable. Shortcuts are centralized in `app/hooks/use-keyboard-shortcuts.ts`.

## Open questions

- Does the light theme get the same design attention as dark, or is it a best-effort secondary?
- Should the "ungenerated stop" cost hint show the *estimated* credit cost (requires a token estimate) or just a generic "1 translation" marker? (Current: generic.)
- ~~Mobile layout for the CAT-tool split~~ — resolved: **stacked** (source above target) under 720px; under 900px the three columns become a single pane switched by `.app-body[data-pane]` (characters → threads → workspace) with back buttons. Explain and the customize panel go full-width. See [FRONTEND.md](./FRONTEND.md#mobile--pwa).
