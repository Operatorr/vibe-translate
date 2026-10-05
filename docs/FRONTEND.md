# FRONTEND.md

> Visual/interaction design is in [DESIGN.md](./DESIGN.md); the API the frontend calls is in [API.md](./API.md); domain terms in [../CONTEXT.md](../CONTEXT.md).

## Stack

- **React 19 + Vite + TypeScript** (strict). Source under `app/`.
- **TanStack Router** — file-based routes in `app/routes/`, generated `app/routeTree.gen.ts` (via `@tanstack/router-plugin` in `vite.config.ts`).
- **TanStack Query** — server-state cache, invalidation, optimistic updates. Segment creates cancel stale reads before the call and before merging its response; an unloaded segment list is refetched in full.
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

- Public: landing (`index.tsx`), `pricing`, `auth`, `legal`, `changelog`, `invite`, `dev/diagnostics`.
- `auth.tsx` is the one auth page: sign-in, sign-up, forgot password, and the new-password form (opened by the reset link's `?token=`), plus **Continue with Google**. `?error=<code>` (failed link, Google error, `account_not_linked`) is shown inline. Every auth email and OAuth round-trip lands back here, and a signed-in visitor is forwarded to `/app` (`replace`). It uses the marketing `SiteNav` with `route="/auth"`, which hides the nav's own Sign in / Start translating CTAs there.
- Public: `share/$token` — read-only **Share link** page (`app/components/app/shared-thread-view.tsx`), no auth.
- Authenticated product lives under `app/routes/app/`. `app/routes/app/route.tsx` is the auth gate. `useSignedIn()` is tri-state: `undefined` while loading **or when the session fetch fails** (offline, worker down) renders the loading shell, so the PWA doesn't bounce an offline user; `false` redirects to `/auth` with `replace` (so Back from `/auth` returns to the previous page instead of bouncing through `/app`); `app/routes/app/index.tsx` renders `AppExperience`.

## The app shell (`app/components/app/`)

`app-experience.tsx` owns the shell: active Character/Thread, the mobile pane, the open panel, hover-align state, and every action (send, retry, speak, star, share, download, rename/archive/delete, create/customize character). It composes: `send` resolves only once the Segment lands: the composer flushes interim dictation into the draft, clears the draft on success (a 402/timeout keeps it), sends are serialized per thread and wait for the thread list so they never mint a spare thread; drafts and pending cards are scoped per thread, so switching threads permits another send without losing the first draft, and a thread created for a failed send is deleted. Speak uses a generation token in `tts.ts`, so Stop/switch cancels an in-flight ElevenLabs fetch and never falls back to browser speech.

- `composer.tsx` — Vibe slider (`VibeMini`, keyboard-operable), `TempSlider` (PATCHes the Character's temperature on release), the textarea with char/token counter, **mic** (Web Speech API dictation in the source language, `app/lib/speech-recognition.ts`), **attach** (reads a text file into the draft), **code** (wraps the selection in backticks; the translate prompt keeps code verbatim), and send (Enter; Shift+Enter for newline).
- `segment-card.tsx` — one **Segment** (newest first, older ones collapse to a source pill) with COPY / RETRY / SPEAK / EXPLAIN, hover- or tap-to-align, and a `PendingSegmentCard` while a translation is in flight.
- `explain-panel.tsx` — renders the real `ExplainBody` (romaji, gloss, morphemes, kanji, grammar); shows an upgrade callout on a `403`.
- `character-panel.tsx` — create (**Add new character**) and customize modes. Name, age, region, tone, verbosity, temperature, traits, languages, default vibe, free-form instructions; the compiled system-prompt preview (`app/lib/system-prompt.ts`, a mirror of `api/_lib/prompts.ts`) updates live with every input. Tone defaults to Neutral and verbosity at its default (0.4) is omitted, so a Character with no other persona stays cache-canonical ([adr/0004](./adr/0004-shared-canonical-translation-cache.md)).
- `thread-menus.tsx` — the **Options** menu (rename, copy as Markdown, close explain, archive, delete) and the **Share** popover (public-link switch, copy, disable). Both are Radix — `@radix-ui/react-dropdown-menu` for the menu, `@radix-ui/react-popover` (via `components/ui/popover.tsx`) for Share — for focus management, `menu`/`menuitem` semantics, and focus return.
- `account-menu.tsx` — the top-nav account slot (initials button → name/email + **Sign out**), a Radix dropdown in place of the old Clerk `UserButton`.
- Command palette (`⌘K`, `app/components/vibe-design/shell.tsx`) lists commands, every Character, and the active Character's Threads for jump-to.

Text-to-speech lives in `app/lib/tts.ts`: ElevenLabs via the worker for Pro+ Japanese, browser speech synthesis otherwise (see [CONTEXT.md](../CONTEXT.md) → Browser voice). Markdown download/copy is `app/lib/markdown-export.ts`.

## Folder conventions

- `app/components/ui/` — low-level reusable primitives (mostly Radix-based).
- `app/components/app/` — authenticated product UI (see "The app shell" above) plus the shared-thread view.
- `app/components/marketing/` — public marketing layout pieces.
- `app/components/landing/` — interactive landing-page demo components.
- `app/components/vibe-design/` — the design-prototype-derived landing/pricing pages (`vibe-pages.tsx`), the shared chrome (`shell.tsx`: `SiteNav`, `CommandPalette`; `icon.tsx`; `use-vibe-frame.ts` for theme/palette state) and the design data (`design-data.ts`), including `VIBE_PRESETS_PER_LANG`.
- `app/hooks/` — `use-app-data.ts` (every TanStack Query hook + mutation for me/characters/threads/segments/explain/share/TTS, with optimistic updates), keyboard shortcuts, mobile back-button handling, `use-api-query.ts`.
- `app/lib/` — `api.ts` (the only low-level fetch wrapper), `auth-client.ts` (`authClient`, `useSignedIn`, `signOut`), contexts, shared `types.ts`, `schemas.ts` (client-side form schemas), query-cache persistence, route utilities, animation config.
- `app/styles/app.css` — Tailwind v4 theme tokens + design system variables.

## Data flow

1. Components call domain hooks in `app/hooks/`.
2. Hooks call `app/lib/api.ts`. Auth is the Better Auth session cookie (`credentials: 'include'`, same origin), so there are no tokens or auth headers to plumb. The `use-app-data.ts` queries are enabled only once `useSignedIn()` is `true`.
3. **`app/lib/api.ts` is the only browser fetch wrapper** — it centralizes JSON handling, credentials, blob responses, and API error normalization (matching the `{ error: { message, status, details? } }` envelope from the worker).
4. **TanStack Query** owns server-state caching, invalidation, optimistic updates, background refetch.
5. Shell/UI state that is _not_ server-owned lives in React contexts, not Query.

Domain types in `app/lib/types.ts` (`Character`, `Thread`, `Segment`, `VibeStop`, `Persona`, `CreditBalance`, `ByokState`, …) are defined independently from the server's Zod inferences. They should agree with the API but are not generated from it — agreement is maintained by review, not a codegen step.

## Mobile & PWA {#mobile--pwa}

- **Layout.** Under 900px the three-column shell collapses to one pane at a time, driven by `.app-body[data-pane="chars" | "threads" | "workspace"]` (state in `AppExperience`; back buttons carry the `.mobile-only` class). Under 720px a Segment stacks source above target. Composer settings stack; the customize panel and Explain go full-width. Going deeper pushes a history entry (`history.state.vtPane`), so the hardware/gesture back button steps workspace → threads → characters instead of leaving `/app`; the in-UI back chevrons pop the same entries.
- **Install.** `public/manifest.webmanifest` (`start_url: /app`, standalone, PNG icons under `public/icons/` generated from `public/icon.svg`) plus the iOS meta tags in `index.html`. `app/lib/pwa-install.tsx` shows an install toast on mobile: the native prompt on Chromium (`beforeinstallprompt`), the "Share → Add to Home Screen" hint on iOS. Dismissal is remembered for 14 days. Desktop Chromium keeps the browser's own install UI (`beforeinstallprompt` is only intercepted when the toast is actually shown). Only an explicit dismissal starts the 14-day quiet period — Sonner's timeout fires `onAutoClose`, not `onDismiss`.

## Offline & cache {#offline--cache}

- `public/sw.js` registers a PWA service worker in production. Static assets are cache-first; navigations are network-first with cached fallback; **`/api/*` is never cached**. In `import.meta.env.DEV` the client skips registration and unregisters any leftover worker so HMR/WebSocket is not intercepted. Install fails (keeping the previous worker) if the app shell can't be precached; icons/manifest are best-effort, and runtime cache writes never reject unhandled.
- `app/lib/query-cache-persist.tsx` persists selected query data (`characters`, `threads`, `segments`, `activity`) to IndexedDB via `idb-keyval`. The persisted cache is a single IndexedDB key (`CACHE_KEY` in `app/lib/query-cache-store.ts`), not per-user. Optimistic temporary records are filtered before persisting. `signOut()` (`app/lib/auth-client.ts`) ends the session, deletes that key, and hard-navigates to `/`, so neither persisted nor in-memory Query state from one account reaches the next.

## Vibe presets on the client

The per-language **Vibe preset table** (`VIBE_PRESETS_PER_LANG` in `app/components/vibe-design/design-data.ts`) maps each universal **Vibe stop** ID to its localized label, hint, and color. This is the client-side display layer; the six stop IDs themselves are the contract shared with the server (`api/_lib/schemas.ts → VIBE_STOPS`). Keep the two ID lists in lockstep.

## Build & scripts

- `pnpm dev` — Wrangler worker only.
- `pnpm dev:vite` — Vite SPA with `/api` proxied to Wrangler on `:8787`. `VITE_*` comes from `.dev.vars` (and any `.env*`).
- `pnpm dev:full` — both together (the usual local command).
- `pnpm build` — `tsc --noEmit && vite build`.
- `pnpm lint` / `pnpm format` — ESLint / Prettier.
