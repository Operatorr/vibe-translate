# DESIGN.md

> Component/layout implementation is in [FRONTEND.md](./FRONTEND.md). Product rationale for the interactions below is in [PRODUCT.md](./PRODUCT.md). Domain terms in [../CONTEXT.md](../CONTEXT.md).

## Design system

- **Tailwind CSS v4** via `@tailwindcss/vite`. Theme tokens are declared in `app/styles/app.css` under `@theme`, mapping semantic names (`--color-background`, `--color-panel`, `--color-accent`, …) onto a raw palette.
- **Dark-default, with a light theme.** Themes switch on `[data-theme='dark']` / `[data-theme='light']` at the document root. Dark is the primary, designed-first surface.
- **Radix primitives** for accessible interactive components, composed with `class-variance-authority` (variants), `tailwind-merge` + `clsx` (class composition), and `lucide-react` icons.
- **Framer Motion** for product animation; local helpers in `app/lib/animation.ts`. The landing uses lazy-loaded **GSAP + ScrollTrigger**, **Lenis** on fine pointers, and an original **Three.js spectral shader** in its hero. The hero adds local pointer-driven RGB separation; the CTA keeps its original broad rainbow wash, rotating every 24 seconds with a stronger pointer pull and RGB separation. Its shader uses a spinning CSS wash as the fallback. The headline’s color cycle takes 4.5 seconds. Touch scroll stays native. Static CSS posters and finished text remain when effects are disabled; system reduced motion and a page Motion toggle bypass animation.

### Palette gotcha

The repo overloads Tailwind size tokens (e.g. `2xl`, `3xl`). **Use explicit widths** like `max-w-[42rem]` instead of `max-w-2xl` / `max-w-3xl`, which resolve to non-standard values here.

## The Vibe color ramp

The six **Vibe stops** have fixed brand colors forming a rough "heat" ramp from rough/intimate to formal/ceremonial. These come from the raw palette in `app.css` and the `VIBE_PRESETS_PER_LANG` table:

| stop      | token           | hex       |
| --------- | --------------- | --------- |
| yakuza    | `--red-400`     | `#ff2e2e` |
| friend    | `--orange-400`  | `#ff5722` |
| casual    | `--amber-400`   | `#ff8a00` |
| keigo     | `--turq-400`    | `#10c594` |
| keigoplus | `--cyan-400`    | `#00a8ff` |
| emperor   | `--magenta-400` | `#ff1f9d` |

The color is consistent across all languages. Each stop carries three texts: a **label** and **hint** in the user's _source_ language, and the **native** term for that register in the _target_ language. The slider shows labels, so a learner can read it before they can read the target; the header names the active stop as `label · native · hint` ("Keigo · 丁寧語 · standard polite", "Polite · 禮貌 · 您 · respectful"). Labels are English by default and tuned per target (`keigoplus` → "Keigo+" for `ja-JP`, "Formal" for `zh-TW`); a Japanese, Chinese or Thai source swaps in generic labels in that language. `getVibesForLang(target, source)` in `design-data.ts` builds the list.

## Key interactions

### The Vibe slider {#the-vibe-slider}

- A **6-stop discrete slider**, color-coded per the ramp above. Stops are selectable by click, drag, or keyboard (arrow keys move between stops). Pressing anywhere on the rail jumps to the nearest stop; dragging (mouse or touch) snaps from stop to stop under the pointer. The rail sets `touch-action: none` so a horizontal drag on a phone moves the stop instead of the page (`app/lib/snap-drag.ts`). The landing demo uses the same handlers.
- **Commit-to-translate**, not translate-on-move: sliding previews the selection but does not fire a translation on every stop. The user commits one stop → one translation runs. This is a deliberate cost guard (see [PRODUCT.md](./PRODUCT.md#the-wedge) and [adr/0004](./adr/0004-shared-canonical-translation-cache.md)).
- **Generated vs. ungenerated stops are visually distinct.** A stop already translated for this source text shows as a **filled dot** (tapping it is instant + free — served from history or the shared cache). An ungenerated stop shows as a **hollow dot** with a subtle "1 translation" cost hint; committing it spends credits (unless BYOK).

- **Retry reuses the drawer's controls.** RETRY on a Segment opens a small dialog with the same Vibe slider, temperature slider and perspective radios, in the drawer's order. They start at the Segment's stop and perspective and the Character's temperature. Confirm unchanged for a fresh take, or change them first to re-translate that Segment in another register or voice. The picks are for that retry only and don't change the Character. Same commit-to-translate rule: one Confirm, one translation, replacing the card's target in place.

### Perspective radios

- Two native radios under Temperature in the composer drawer: **As the Character** (left) and **To the Character** (right). Desktop puts Temperature and Perspective in the drawer's right column; at 720px and below they stack under the Vibe slider, and at 900px and below the radios grow to 44px touch targets. Each option redraws the hidden native radio's dot (hollow, filled when checked) so the choice never rests on color alone, and checked options use the `Highlight` system color in forced-colors mode; the Character panel's perspective chips do the same. In the light theme the checked label uses blue-600 for 4.5:1 contrast. The head shows a compact "?" beside the PERSPECTIVE label, which opens the explanation dialog (both options, when to pick which, and Japanese examples at Emperor and Yakuza), and a short hint on the right ("in their voice" / "addressed to them"). The "?" is 22px with a 44px hit area. The Character panel uses the same dialog.
- The choice belongs to the Character and saves on change. It also shows while the drawer is shut, in the placeholder ("Write to …" / "Speak as …") and the toggle's label.
- Segment cards, the pending card, share pages and Markdown exports tag the vibe label with `as Character` / `to Character`. Legacy Segments without a recorded perspective get no tag.

### Hover-to-align

- Hovering a word on the **source** or **target** side highlights its counterpart on the other side, using the per-token `token_alignment` map (`{ t, src }` pairs).
- **Touch fallback:** there is no hover on touch devices, so the alignment is triggered by **tap** instead. Tapping a token — on either side — pins its pair; tapping it again, or anywhere outside the card, clears. A mouse click pins the same way, and mouse hover never overrides a pin. Matching is by exact word (`app/lib/alignment.ts`), never substring.

### Reading toggle (Pinyin / Kana)

- Chinese targets get a **Pinyin** toggle (glyph `ā`), Japanese targets a **Kana** toggle (glyph `あ`), between Speak and Explain. Off by default, per card and not persisted, so the learner tries to read the sentence first and checks after.
- When enabled, the target text renders as `<ruby>`: Pinyin over every Chinese character, furigana over Japanese kanji only (okurigana stay bare). If a morpheme's kana can't be matched to its reading, the whole morpheme gets the reading instead. Readings sit inside the alignment tokens, so hover-align still works; they are `user-select: none` so a manual selection copies just the sentence. The sentence is always read as a whole, so a reading never depends on where the alignment splits it; a reading that spans two alignment tokens (御飯 split as 御 | 飯) can't be divided reliably and is left off. While the first Kana load downloads the dictionary the toggle is `aria-busy` and a polite status announces loading and completion.
- Readings are generated in the browser (`app/lib/readings.ts`), free and available on every Segment, old ones and share links included. Accuracy is the library's: polyphones (長 cháng/zhǎng) and context-dependent kanji readings can be wrong. Explain is the authoritative breakdown.

### Explain panel

- The **Explain** button sits at the right end of the Segment's action row, apart from the icon actions on the left (it wraps to its own row, still right-aligned, if space runs out).
- **Explain** opens **inline, directly under its Segment card**, not as a modal — the translation stays visible right above the breakdown so the learner can cross-reference. One panel is open at a time.
- On open, and again when its content loads, the panel **slides into view**: the thread scrolls smoothly up until the panel clears the composer, but never past the top of its Segment card, so the translation stays on screen above the breakdown. Instant under `prefers-reduced-motion`.
- The panel renders the language-aware payload: romaji, literal gloss, morphemes & particles (color-coded by part of speech), kanji decomposition (radicals, readings, JLPT, stroke count), and grammar patterns with dialect notes.

## Layout

- **CAT-tool surface, not a chat wrapper.** Source on the left, target on the right; past **Segments** in a thread collapse to compact pills above the active one. This is a deliberate departure from chat-bubble UIs — the product is for reviewing and learning from translations, not conversing.
- The authenticated shell (`app/routes/app/`) holds a persistent header, a **Character** sidebar, the active thread workspace, and overlays (command palette, customize-character panel).

## Accessibility baseline

- Color is never the sole signal — vibe stops pair color with labels; generated/ungenerated dots pair color with fill state.
- Radix primitives carry focus management and ARIA semantics; keep them rather than hand-rolling dialogs/menus.
- Keyboard: the vibe slider, quick-find (`⌘K`), and panel close are all keyboard-operable. Shortcuts are centralized in `app/hooks/use-keyboard-shortcuts.ts`.

## Open questions

- Does the light theme get the same design attention as dark, or is it a best-effort secondary?
- Should the "ungenerated stop" cost hint show the _estimated_ credit cost (requires a token estimate) or just a generic "1 translation" marker? (Current: generic.)
- ~~Mobile layout for the CAT-tool split~~ — resolved: **stacked** (source above target) under 720px; under 900px the three columns become a single pane switched by `.app-body[data-pane]` (characters → threads → workspace) with back buttons. Explain and the customize panel go full-width. See [FRONTEND.md](./FRONTEND.md#mobile--pwa).
