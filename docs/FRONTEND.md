# FRONTEND.md

> Visual/interaction design is in [DESIGN.md](./DESIGN.md); the API the frontend calls is in [API.md](./API.md); domain terms in [../CONTEXT.md](../CONTEXT.md).

## Stack

- **React 19 + Vite + TypeScript** (strict). Source under `app/`.
- **TanStack Router** — automatically split file-based routes in `app/routes/`, generated `app/routeTree.gen.ts` (via `@tanstack/router-plugin` in `vite.config.ts`).
- **TanStack Query** — server-state cache, invalidation, optimistic updates. Segment creates cancel stale reads before the call and before merging its response. A dedupe hit (`reused: true`) is replaced in place when loaded, left in its unloaded older page otherwise, and never bumps the Thread count; unloaded or stale Segment history is refetched as a bounded first page.
- **Better Auth** client (`better-auth/react`, `app/lib/auth-client.ts`) — auth/session over a same-origin httpOnly cookie. See [SECURITY.md](./SECURITY.md#authentication).
- **Tailwind v4**, Radix, CVA, lucide, Framer Motion (see DESIGN.md).
- `@/*` resolves to `app/*`.

## Providers

`app/main.tsx` creates the router and renders the global providers; `app/routes/__root.tsx` adds the chrome:

- `QueryClientProvider` — TanStack Query.
- `CacheHydrator` — hydrates selected query cache from IndexedDB and subscribes to writes (see Offline & cache).
- `RouterProvider`, the PWA `InstallPrompt`, and `sonner` toasts (`main.tsx`); `ErrorBoundary` and `OfflineBanner` (`__root.tsx`).

There is no auth provider: `authClient` is a module singleton, and components read the session with `authClient.useSession()` or the `useSignedIn()` wrapper.

## Routes

- Public: landing (`index.tsx`), `pricing`, `auth`, `legal`, `invite`, `dev/diagnostics`.
- `auth.tsx` is the one auth page: sign-in, sign-up, forgot password, and the new-password form (opened by the reset link's `?token=`), plus **Continue with Google**. `?error=<code>` (failed link, Google error, `account_not_linked`) is shown inline. Every auth email and OAuth round-trip lands back here, and a signed-in visitor is forwarded to `/app` (`replace`). It uses the marketing `SiteNav` with `route="/auth"`, which hides the nav's own Sign in / Start translating CTAs there.
- Public: `share/$token` — read-only **Share link** page (`app/components/app/shared-thread-view.tsx`), no auth.
- Authenticated product lives under `app/routes/app/`. `app/routes/app/route.tsx` is the auth gate. `useSignedIn()` is tri-state: `undefined` while loading **or when the session fetch fails** (offline, worker down). The gate renders loading only while pending; a settled session error opens the shell with the last confirmed account’s offline cache; `false` redirects to `/auth` with `replace` (so Back from `/auth` returns to the previous page instead of bouncing through `/app`); `app/routes/app/index.tsx` renders `AppExperience`.

## The app shell (`app/components/app/`)

`app-experience.tsx` owns the shell: active Character/Thread, the mobile pane, the open panel, hover-align state, and every action (send, retry, speak, star, share, download, rename/archive/delete, create/customize character). It composes: `send` resolves only once the Segment lands: the composer flushes interim dictation into the draft, clears the draft on success (a 402/timeout keeps it), sends are serialized per thread and wait for the thread list so they never mint a spare thread; drafts (also per account, persisted; see `composer.tsx`) and pending cards are scoped per thread, so switching threads permits another send without losing the first draft, and a thread created for a failed send is deleted. Speak uses a generation token in `tts.ts`, so Stop/switch cancels an in-flight ElevenLabs fetch and never falls back to browser speech. A dedupe hit (`reused`) spends no credits: instead of collapsing and scrolling for a new card, the shell shows a toast and expands the existing card if it is loaded. The workspace shows a loader while bootstrap is fetching and no Character data exists, before the empty-character prompt.

- `composer.tsx` — a default-closed settings drawer toggled by the icon above Send, with the Vibe slider (`VibeMini`, keyboard-operable), `TempSlider` (PATCHes the Character's temperature on release), the textarea with char/token counter, **mic** (Web Speech API dictation in the source language, `app/lib/speech-recognition.ts`), **attach** (reads a text file into the draft), **code** (wraps the selection in backticks; the translate prompt keeps code verbatim), and send (Enter; Shift+Enter for newline). The settings toggle carries the active Vibe's color dot and names it (`Vibe and temperature · Casual`); opening it from the keyboard focuses the Vibe slider, since the drawer precedes the toggle in DOM order. Drafts persist per account in sessionStorage (`app/lib/draft-store.ts`, key `vibe-translate:drafts:<userId>`), so they survive in-app navigation and the checkout round trip in that tab but never reach another tab or account. A successful send, sign-out and password reset clear them; with no session user or no storage they stay in memory.
- `segment-card.tsx` — one **Segment** (newest first, older ones collapse to a source pill) with an icon-only full-screen target translation display (large text, Close / Escape, focus return; also on Share links), COPY / RETRY / SPEAK / EXPLAIN, hover- or tap-to-align, and a `PendingSegmentCard` while a translation is in flight. The display is Back-aware (`app/hooks/use-back-button-close.ts`): opening pushes one entry copying `history.state`, so the first Back closes it without changing panes; an explicit close pops that entry, leaving no extra history. `segment-usage.tsx` shows the generation-time credit charge for new translations; tapping it opens the provider input/output/total token breakdown. Older records without a stored charge show their recorded total tokens instead. Legacy partial usage is labelled input/output only (its accessible name gives the known count and says the total is not recorded), missing or malformed counts (only non-negative safe integers or digit strings count) stay unknown, and cached translations show zero credits.
- `explain-panel.tsx` — renders the real `ExplainBody` (romaji, gloss, morphemes, kanji, grammar); shows an upgrade callout on a `403`.
- `character-panel.tsx` — create (**Add new character**) and customize modes. Name, age, region, personality tone, verbosity, temperature, traits, languages, default vibe, free-form instructions; the compiled system-prompt preview (`app/lib/system-prompt.ts`, a mirror of `api/_lib/prompts.ts`) updates live with every input. Targets are Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), Thai (`th-TH`) and Japanese (`ja-JP`); English (`en-US`) is also available as a source. `app/lib/character-options.ts` owns the selectors and language-specific region/trait suggestions. Regions use a free-text input with suggestion buttons; custom cities such as Taichung are valid. Changing target language clears suggestions selected for the old language while retaining custom values and common traits. Draft state and its transitions (`switchTargetLanguage`, `toInput`, `toCharacterPatch`) live in `app/lib/character-draft.ts`. Editing a Character with a legacy (now unsupported) language validates with `characterEditSchema`, which accepts the saved languages while unchanged, and the PATCH omits unchanged languages. Hong Kong/Guangzhou suggestions select written Cantonese in traditional characters; a region that negates Cantonese or also names Mandarin does not. Vibe controls formality; personality tone is subordinate. The redundant formality field is shown only for Characters that saved a value, and stays mounted while cleared so it can be retyped. `character-setting-help.tsx` provides Radix help dialogs with examples for verbosity and temperature. Tone defaults to Neutral and verbosity at its default (0.4) is omitted, so a Character with no other persona stays cache-canonical ([adr/0004](./adr/0004-shared-canonical-translation-cache.md)).
- `thread-menus.tsx` — the **Options** menu (star/unstar, download as Markdown, rename, copy as Markdown, close explain, archive, delete) and the **Share** popover (public-link switch, copy, disable). Both are Radix — `@radix-ui/react-dropdown-menu` for the menu, `@radix-ui/react-popover` (via `components/ui/popover.tsx`) for Share — for focus management, `menu`/`menuitem` semantics, and focus return.
- `account-menu.tsx` — the top-nav account slot (initials button → name/email, **Profile & credits**, **Upgrade account** to pricing, **Sign out**), a Radix dropdown in place of the old Clerk `UserButton`. Also mounted on `/app/credits`.
- Command palette (`⌘K`, `app/components/vibe-design/shell.tsx`) lists commands, every Character, and the active Character's Threads for jump-to.

Text-to-speech lives in `app/lib/tts.ts`: ElevenLabs via the worker for Pro+ Japanese, browser speech synthesis otherwise (see [CONTEXT.md](../CONTEXT.md) → Browser voice). Markdown download/copy is `app/lib/markdown-export.ts`.

## Folder conventions

- `app/components/ui/` — low-level reusable primitives (mostly Radix-based).
- `app/components/app/` — authenticated product UI (see "The app shell" above) plus the shared-thread view.
- `app/components/marketing/` — public marketing layout pieces.
- `app/components/landing/` — landing motion and spectral backdrops. `landing-motion.ts` lazy-loads GSAP/ScrollTrigger and the sole smooth-scroll engine, Lenis (fine pointers only). `spectrum-backdrop.tsx` lazy-loads Three.js for the hero when visible, with a CSS spectral poster, 30fps/DPR caps, offscreen/hidden/blur suspension, pointer response, and resource cleanup. `cta-backdrop.tsx` keeps the closing CTA’s broad rainbow wash, with a 24-second rotation and stronger cursor refraction through its own shader. It uses a rotating CSS fallback, caps rendering at 30fps/1.25 DPR, and pauses offscreen or when hidden/unfocused. The landing’s Motion toggle and system reduced-motion preference disable animation; reduced motion uses the static poster. `reveal-heading.tsx` keeps an unsplit accessible heading name alongside decorative word spans.
- `app/components/vibe-design/` — the design-prototype-derived landing page (`vibe-pages.tsx`) and pricing page (`pricing-page.tsx`), the shared chrome (`shell.tsx`: `SiteNav`, `CommandPalette`; `icon.tsx`; `use-vibe-frame.ts` for theme/palette state) and the design data (`design-data.ts`), including `VIBE_PRESETS_PER_LANG`.
- `app/hooks/` — `use-app-data.ts` (every TanStack Query hook + mutation for me/characters/threads/segments/explain/share/TTS, with optimistic updates), keyboard shortcuts, mobile back-button handling, `use-api-query.ts`.
- `app/lib/` — `api.ts` (the only low-level fetch wrapper), `auth-client.ts` (`authClient`, `useSignedIn`, `signOut`), contexts, shared `types.ts`, `schemas.ts` (client-side form schemas), query-cache persistence, route utilities, animation config.
- `app/styles/app.css` — Tailwind v4 theme tokens + design system variables.

## Data flow

1. The cold product shell requests `/api/app/bootstrap`, which seeds the existing Query keys for me, Characters, the selected Character's Threads, and the first Segment page. Nested consumers do not repeat these reads. Bootstrap is a transport query (`gcTime: 0`), not a second snapshot cache; it only seeds missing domain data and cannot overwrite newer data or a cancelled account response. Warm returns use domain caches (30 seconds; me 60 seconds). Bootstrap failures fall back to individual queries and existing retry UI. A Character's first visit reads `/api/app/workspace` (its Threads plus the newest Thread's first page, seeded only if that history is missing); if that fails, Threads come from `/api/threads` and the selected Thread loads its own first page. Refreshes read only `/api/threads`. Creating a Character merges it by ID into a loaded roster; with no roster loaded (bootstrap pending or the read failed), it fetches `/api/characters` instead of writing a one-row list.
2. Components call domain hooks in `app/hooks/`. Segment history uses 50-row backward cursor pages and an explicit **Load older translations** button; overlapping reads are blocked. Create/retry updates preserve loaded older pages and pagination cursors; `useCreateSegment` resolves with `reused`, so the UI can react to a dedupe hit while the cache stores the plain Segment. Markdown download/copy (`app/components/app/use-thread-export.ts`) is always complete: when no older page remains it renders the cached history (so it works offline); otherwise it fetches the full history. An unknown public link is resolved into the share cache during export and omitted when offline or on error. One preparation runs per Thread, and both actions are disabled while it runs. Copy keeps the click's user activation: cached text is written directly; otherwise `navigator.clipboard.write` starts inside the click with a promise-backed `text/plain` `ClipboardItem`, and if that is unsupported or refused a toast offers a second-click **Copy** of the prepared text. Network failures advise reconnecting; only a failed browser save suggests Copy as Markdown. Share status loads when its popover opens (five-minute browser freshness), with explicit error/retry UI. The shell owns the popover's open state per Thread (`use-share-open.ts`), so switching Threads closes it and never fetches status early.
3. Hooks call `app/lib/api.ts`. Auth is the Better Auth session cookie (`credentials: 'include'`, same origin), so there are no tokens or auth headers to plumb. The `use-app-data.ts` queries are enabled only once `useSignedIn()` is `true`.
4. **`app/lib/api.ts` is the only browser fetch wrapper** — it centralizes JSON handling, credentials, blob responses, and API error normalization (matching the `{ error: { message, status, details? } }` envelope from the worker).
5. **TanStack Query** owns server-state caching, invalidation, optimistic updates, background refetch.
6. Shell/UI state that is _not_ server-owned lives in React contexts, not Query.

Domain types in `app/lib/types.ts` (`Character`, `Thread`, `Segment`, `VibeStop`, `Persona`, `CreditBalance`, `ByokState`, …) are defined independently from the server's Zod inferences. They should agree with the API but are not generated from it — agreement is maintained by review, not a codegen step.

## Mobile & PWA {#mobile--pwa}

- **Layout.** Under 900px the three-column shell collapses to one pane at a time, driven by `.app-body[data-pane="chars" | "threads" | "workspace"]` (state in `AppExperience`; back buttons carry the `.mobile-only` class). Under 720px a Segment stacks source above target. Composer settings stack; the customize panel and Explain go full-width. Going deeper pushes a history entry (`history.state.vtPane`), so the hardware/gesture back button steps workspace → threads → characters instead of leaving `/app`; the in-UI back chevrons pop the same entries.
- **Install.** `public/manifest.webmanifest` (`start_url: /app`, standalone, PNG icons under `public/icons/` generated from `public/icon.svg`) plus the iOS meta tags in `index.html`. `app/lib/pwa-install.tsx` mounts the controller in `pwa-install-controller.ts`: a persistent, bottom-center "Install Vibe Translate?" toast on mobile HTTPS visits. Chromium shows it when `beforeinstallprompt` reports eligibility; **Install** opens the native prompt. iOS shows Share/browser-menu → Add to Home Screen instructions after 2.5 seconds, including the Open as Web App setting on newer iOS. **Not now**, closing the toast, or dismissing the native prompt starts a 14-day quiet period. Installed standalone windows suppress the prompt, and `appinstalled` removes it immediately. Desktop Chromium keeps the browser's own install UI. Toast offsets respect mobile safe areas.

## Offline & cache {#offline--cache}

- `public/sw.js` is the production service-worker template. The `pwaPrecache` Vite build plugin embeds the exact built HTML, injects all emitted assets (including lazy chunks) with SHA-256 integrity checks, and derives a version from the worker, HTML, bundle, manifest, and icons. The manifest/icon inventory is defined once in `build/pwa-precache.ts`. The entire shell and bundle must be precached before installation succeeds; integrity checks reject mismatched releases and SPA fallback HTML served as JavaScript. The shell is embedded rather than fetched from the mutable deployment root; icons/manifest are best-effort. Static assets are cache-first; navigations are network-first with the build's cached HTML as fallback. Online navigations never overwrite that shell with HTML from another release. Updates wait for open tabs to close before activation and old-cache cleanup. **`/api` and `/api/*` are never intercepted or cached**; only `/assets/*` and explicit public PWA assets enter the static cache. Runtime cache writes never reject unhandled. In `import.meta.env.DEV` the client unregisters this app's leftover worker and removes only its static caches so HMR/WebSocket is not intercepted. `public/_headers` and registration's `updateViaCache: 'none'` ensure service-worker updates bypass stale HTTP caches.
- **Offline limits.** After a successful online visit, the installed app can open offline and display previously synced, account-scoped data. New translations, explanations, server-generated audio, sign-in, and sync require a connection; there is no offline generation or queued-mutation system.
- `app/lib/query-cache-persist.tsx` provides cache readiness; the product gate waits for ownership to settle while public auth forms stay mounted. `query-cache-store.ts` persists selected data (`characters`, `threads`, `segment-pages`, `activity`) under an IndexedDB key scoped by Better Auth user id, with original update timestamps. Only a settled session error permits hydration using the last confirmed owner; a confirmed signed-out session deletes their cache. Account changes cancel and clear personalized queries (explicitly public share and diagnostics reads survive session hydration), discard the previous owner’s blob, and hydrate only matching entries. Sign-out pauses the persister before clearing memory, waits for queued writes, then deletes the blob and owner pointer before ending the session and navigating home. The legacy unscoped blob is discarded.

## Vibe presets on the client

The per-language **Vibe preset table** (`VIBE_PRESETS_PER_LANG` in `app/components/vibe-design/design-data.ts`) maps each universal **Vibe stop** ID to its localized label, hint, and color. This is the client-side display layer; the six stop IDs themselves are the contract shared with the server (`api/_lib/schemas.ts → VIBE_STOPS`). Keep the two ID lists in lockstep.

## Build & scripts

- `pnpm dev` — Wrangler worker only.
- `pnpm dev:vite` — Vite SPA with `/api` proxied to Wrangler on `:8787`. `VITE_*` comes from `.dev.vars` (and any `.env*`).
- `pnpm dev:full` — both together (the usual local command).
- `pnpm build` — `tsc --noEmit && vite build`.
- `pnpm lint` / `pnpm format` — ESLint / Prettier.

## Performance and mutation ownership

See [PERFORMANCE.md](./PERFORMANCE.md) for baseline/after evidence, coverage, cache rules, and remaining work. Ordinary resource reads consume Query's abort signals; a one-microtask check avoids launching the cancelled StrictMode request. Explain is the deliberate exception: generating an explanation spends credits, so its read ignores cancellation and a quickly closed panel still lets the paid request finish and cache. Queries use `retryTransient` (`app/lib/query-client.ts`): permanent 4xx errors are not retried, and a 5xx or transport failure gets one retry. `scopedMutation` (`app/lib/scoped-mutation.ts`) captures account ownership synchronously at mutation start, keyed by TanStack's per-execution mutation context, so ownership survives observer option replacement and a rejected `onMutate`. A late success, rollback or settle cannot repopulate the next account's Query cache. Same-account callbacks still run and receive the unwrapped `onMutate` result, which is `undefined` when preparation failed. Persistence responds only to successful persisted-data changes and removals, coalesces bursts over `PERSIST_DELAY_MS` (250 ms), and flushes pending work on `pagehide` or when the page becomes hidden; `stop()` and account changes detach those listeners. Generation checks and serialized deletion still protect sign-out. Account-owned pre-pagination Segment arrays migrate for offline access; their next online refetch is bounded.

## Credit recovery and profile

The authenticated layout mounts `CreditRequiredModal`. `apiFetch` emits
`vibe:credits-required` on 402; send/retry suppress their former credit toast.
The Radix dialog traps focus, closes via Escape/close, and restores focus to
what was focused when it opened; that target is captured once per opening (a
synchronous open ref), so a second 402 while open cannot retarget it to the
dialog. Any paid action can 402 over any screen, so it is the topmost overlay
layer (z-index 300/301, above the translation display's 200/201); the display
stays open underneath. Under 600px it fills the viewport; desktop uses a
centered modal. Actions link to `/app/credits` and, by plan, to pricing: Free →
Upgrade to Pro, Pro → Upgrade to Linguist, Linguist (`team`) top-up only with a
largest-plan note, plan still loading → Compare plans. Drafts persist per account
(see `composer.tsx`), so following either link, or leaving for checkout and
coming back, keeps the unsent text. The 402 event carries the rejected request’s balance and required reservation, so the modal does not mistake a positive balance for zero or use a stale cached balance. It explains that the reservation is temporary and settlement uses actual provider usage.

`/app/credits` is the profile/credit surface, linked from Account and the sidebar
balance. The route only validates `?orderId=`; the page is
`app/components/app/credits-page.tsx`. It shows balance (which can be negative),
plan allowance, BYOK status, three Dodo-priced packs, and the latest 50 ledger
entries, including `reversal.purchase` entries (“Top-up reversed”) for refunded
or charged-back top-ups. An unavailable selected pack falls back to the first
available one; with none available it says top-ups are currently unavailable
and suggests refreshing later. Checkout returns poll the owner-scoped order
every 2 seconds and show success only after verified fulfillment. Each order
gets its own one-minute window, then **Check payment** restarts it. Every fresh
history response writes its account into `keys.me`, so **Refresh balance** and
fulfillment update the workspace balance; cached history never overwrites a
newer account read. A BFCache restore (Back from Dodo) re-enables the checkout
button. Account and balance data are not persisted by the offline query cache.
