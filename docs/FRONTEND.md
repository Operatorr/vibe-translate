# FRONTEND.md

> Visual/interaction design is in [DESIGN.md](./DESIGN.md); the API the frontend calls is in [API.md](./API.md); domain terms in [../CONTEXT.md](../CONTEXT.md).

## Stack

- **React 19 + Vite + TypeScript** (strict). Source under `app/`.
- **TanStack Router** — file-based routes in `app/routes/`, generated `app/routeTree.gen.ts` (via `@tanstack/router-plugin` in `vite.config.ts`).
- **TanStack Query** — server-state cache, invalidation, optimistic updates.
- **Clerk** (`@clerk/react`) — auth/session.
- **Tailwind v4**, Radix, CVA, lucide, Framer Motion (see DESIGN.md).
- `@/*` resolves to `app/*`.

## Providers

`app/main.tsx` creates the router and renders `<RouterProvider />`. `app/routes/__root.tsx` owns global providers and chrome:

- `ClerkProvider` — auth/session.
- `QueryClientProvider` — TanStack Query.
- `CacheHydrator` — hydrates selected query cache from IndexedDB and subscribes to writes (see Offline & cache).
- `ErrorBoundary`, `OfflineBanner`, and `sonner` toasts.

## Routes

- Public: landing (`index.tsx`), `pricing`, `auth`, `legal`, `changelog`, `invite`, `dev/diagnostics`.
- Authenticated product lives under `app/routes/app/`. `app/routes/app/route.tsx` is the shell: it redirects unauthenticated users to sign-in, gates first-run users behind **Onboarding**, and wraps content with the app contexts. It owns shell state (sidebar, active view, quick-find, scroll restoration) and renders the persistent header, **Character** sidebar, thread workspace, quick-find modal, and the **Explain** panel overlay.

## Folder conventions

- `app/components/ui/` — low-level reusable primitives (mostly Radix-based).
- `app/components/app/` — authenticated product UI (character list/detail, thread workspace, onboarding, filters).
- `app/components/marketing/` — public marketing layout pieces.
- `app/components/landing/` — interactive landing-page demo components.
- `app/components/vibe-design/` — the design-prototype-derived landing/pricing/app pages (`vibe-pages.tsx`) and their sample data (`design-data.ts`), including `VIBE_PRESETS_PER_LANG`.
- `app/hooks/` — query hooks, keyboard shortcuts (`use-keyboard-shortcuts.ts`), mobile back-button handling (`use-back-button-close.ts`), auth-aware data hooks (`use-api-query.ts`).
- `app/lib/` — `api.ts` (the only low-level fetch wrapper), contexts, shared `types.ts`, `schemas.ts` (client-side form schemas), query-cache persistence, route utilities, animation config.
- `app/styles/app.css` — Tailwind v4 theme tokens + design system variables.

## Data flow

1. Components call domain hooks in `app/hooks/`.
2. Hooks use Clerk's `getToken()` for authenticated requests and call `app/lib/api.ts`.
3. **`app/lib/api.ts` is the only browser fetch wrapper** — it centralizes JSON handling, credentials, bearer headers, blob responses, and API error normalization (matching the `{ error: { message, status, details? } }` envelope from the worker).
4. **TanStack Query** owns server-state caching, invalidation, optimistic updates, background refetch.
5. Shell/UI state that is *not* server-owned lives in React contexts, not Query.

Domain types in `app/lib/types.ts` (`Character`, `Thread`, `Segment`, `VibeStop`, `Persona`, `CreditBalance`, `ByokState`, …) are defined independently from the server's Zod inferences. They should agree with the API but are not generated from it — agreement is maintained by review, not a codegen step.

## Offline & cache {#offline--cache}

- `public/sw.js` registers a PWA service worker. Static assets are cache-first; navigations are network-first with cached fallback; **`/api/*` is never cached**.
- `app/lib/query-cache-persist.tsx` persists selected query data (`characters`, `threads`, `segments`, `activity`) to IndexedDB via `idb-keyval`. Persisted cache is scoped per Clerk user ID. Optimistic temporary records are filtered before persisting. Sign-out clears Query state and the signed-in user's persisted cache.

## Vibe presets on the client

The per-language **Vibe preset table** (`VIBE_PRESETS_PER_LANG` in `app/components/vibe-design/design-data.ts`) maps each universal **Vibe stop** ID to its localized label, hint, and color. This is the client-side display layer; the six stop IDs themselves are the contract shared with the server (`api/_lib/schemas.ts → VIBE_STOPS`). Keep the two ID lists in lockstep.

## Build & scripts

- `pnpm dev` — Wrangler worker only.
- `pnpm dev:vite` — Vite SPA with `/api` proxied to Wrangler on `:8787`.
- `pnpm dev:full` — both together (the usual local command).
- `pnpm build` — `tsc --noEmit && vite build`.
- `pnpm lint` / `pnpm format` — ESLint / Prettier.
