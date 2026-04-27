# VibeTranslate Architecture

- **Application shape**
  - Single-page React app built with Vite, TypeScript, React 19, and Tailwind CSS v4.
  - Frontend source lives under `app/`.
  - Server/API code lives under `functions/api/[[route]].ts` with shared helpers in `api/_lib/`.
  - Database schema and migrations live under `db/`.
  - Public/static assets, PWA files, and SEO files live under `public/`.
  - Cloudflare deployment config lives in `wrangler.toml`.

- **Runtime and deployment**
  - The app is designed for Cloudflare Workers deployment through Wrangler.
  - `wrangler.toml` points the worker entry at `functions/api/[[route]].ts`.
  - Built frontend assets are served from `dist`.
  - Cloudflare assets use SPA fallback behavior so client routes resolve to the React app.
  - API requests under `/api/*` run through the worker before static asset handling.
  - Local development can run through Wrangler with `pnpm dev`, or Vite with API proxying through `pnpm dev:vite`.

- **Frontend routing**
  - Routing uses TanStack Router with file-based routes in `app/routes/`.
  - `vite.config.ts` configures `@tanstack/router-plugin` to generate `app/routeTree.gen.ts`.
  - `app/main.tsx` creates the router and renders `<RouterProvider />`.
  - `app/routes/__root.tsx` owns global providers, error boundaries, offline UI, and the root outlet.
  - Public pages include landing, pricing, auth, legal, changelog, invite, and dev diagnostic routes.
  - Authenticated product routes live under `app/routes/app/`.

- **Global frontend providers**
  - `ClerkProvider` wraps the app for authentication and session access.
  - `QueryClientProvider` wraps the app for TanStack Query server state.
  - `CacheHydrator` hydrates selected query cache entries from IndexedDB and subscribes to future cache writes.
  - `ErrorBoundary` catches runtime UI errors around routed content.
  - `OfflineBanner` surfaces network/offline state.
  - `sonner` provides global toast notifications.

- **Authenticated app shell**
  - `app/routes/app/route.tsx` is the main authenticated layout.
  - It redirects unauthenticated users to `/sign-in`.
  - It gates first-run users behind onboarding.
  - It wraps app content with `SettingsProvider`, `ChatsProvider`, and `AppContext`.
  - It owns shell state such as sidebar visibility, active view, quick find, and scroll restoration.
  - It renders the persistent `AppHeader`, `AppSidebar`, optional chat tabs, route outlet, quick-find modal, and chat detail overlay.

- **Frontend folder conventions**
  - `app/components/ui/` contains reusable low-level UI primitives, mostly Radix-based.
  - `app/components/app/` contains authenticated product UI such as task list, sidebar, calendar, onboarding, filters, and task detail.
  - `app/components/marketing/` contains public marketing layout pieces.
  - `app/components/landing/` contains interactive landing-page demo components.
  - `app/hooks/` contains React Query hooks, interaction hooks, keyboard shortcuts, animation helpers, and auth-aware data hooks.
  - `app/lib/` contains API clients, contexts, shared types, query cache persistence, task utilities, route utilities, schemas, animation config, and settings logic.
  - `app/styles/app.css` contains Tailwind v4 theme tokens, design system variables, base styles, dark-mode overrides, and app-specific CSS.

- **Client data flow**
  - UI components call domain hooks from `app/hooks/`.
  - Domain hooks use Clerk's `getToken()` when authenticated requests need bearer tokens.
  - Hooks call functions in `app/lib/api.ts`.
  - `app/lib/api.ts` centralizes fetch behavior, JSON handling, credentials, bearer token headers, and API error normalization.
  - TanStack Query owns server-state caching, invalidation, optimistic updates, and background refetch behavior.
  - Local UI state that is shell-wide but not server-owned lives in React contexts.

- **Offline and cache behavior**
  - `public/sw.js` registers a PWA service worker.
  - Static assets are cache-first.
  - Navigation requests are network-first with cached fallback.
  - `/api/*` requests are never cached by the service worker.
  - `app/lib/query-cache-persist.ts` persists selected query data to IndexedDB with `idb-keyval`.
  - Persisted cache is scoped per Clerk user ID.
  - Optimistic temporary records are filtered before data is written to IndexedDB.
  - Sign-out clears TanStack Query state and the signed-in user's persisted cache.

- **API architecture**
  - The API is a Hono app inside `functions/api/[[route]].ts`.
  - Global error handling converts `HTTPException`, validation errors, auth errors, and unknown errors into JSON responses.
  - Each route validates request bodies with Zod schemas from `api/_lib/schemas.ts`.
  - Database access is currently performed with `pg.Client` connections created from the Hyperdrive connection string.
  - Authenticated routes use the `auth()` middleware from `api/_lib/auth.ts`.
  - Shared server helpers are split by concern in `api/_lib/`, including auth, permissions, validation, activity logging, recurrence, tier limits, email, Dodo Payments, Resend, and environment types.

- **API surface**
  - Chats: list, detail, create, update, delete, and reorder.
  - Translations: list, create, update, delete.
  - Activity: read user activity history.
  - Users: read/update current user profile, tier, subscription, onboarding, and limits.
  - AI: process dictation into structured chat configuration for AI translations.
  - Billing: create checkout, handle Dodo webhooks, cancel subscription, and switch subscription plan.
  - Utility endpoints: waitlist join, database diagnostics, and data export.

- **Authentication and user provisioning**
  - Clerk is the identity provider.
  - The frontend uses `@clerk/react`.
  - The worker verifies bearer tokens or the `__session` cookie with `@clerk/backend`.
  - On authenticated API requests, the auth middleware upserts the Clerk user into the local `users` table.
  - The middleware stores `userId`, `email`, and the database connection string in Hono context variables.

- **Authorization model**
  - Most user-owned data is scoped by Clerk user ID.
  - Tier-specific feature and retention limits are centralized in `api/_lib/tier.ts`.

- **Database model**
  - PostgreSQL is the primary datastore.
  - Cloudflare Hyperdrive provides the database binding in production.
  - `db/schema.sql` is the canonical bootstrap schema.
  - Incremental schema changes live in `db/migrations/`.
  - Core tables are `users`, `chats`, `translations`, `activity_log`, and `waitlist`.

- **Validation and typing**
  - TypeScript runs in strict mode.
  - `@/*` resolves to `app/*`.
  - Shared frontend domain types live in `app/lib/types.ts`.
  - Server request validation lives in `api/_lib/schemas.ts`.
  - Zod schemas are the API input contract.
  - Frontend and backend types are separate rather than generated from one schema.

- **Styling and design system**
  - Tailwind CSS v4 is configured through `@tailwindcss/vite`.
  - Theme tokens are defined in `app/styles/app.css` with `@theme`.
  - The design system uses custom semantic colors, spacing, radii, typography, shadows, and dark-mode CSS variables.
  - Reusable components prefer Radix primitives, `class-variance-authority`, `tailwind-merge`, and `lucide-react` icons.
  - The repo overloads Tailwind size tokens such as `2xl` and `3xl`; use explicit widths such as `max-w-[42rem]` instead of `max-w-2xl` or `max-w-3xl`.

- **Animation and interaction**
  - App animation uses Framer Motion, and local animation helpers.
  - Keyboard shortcuts are centralized in `app/hooks/use-keyboard-shortcuts.ts`.
  - Mobile back-button panel closing is handled through `app/hooks/use-back-button-close.ts`.
  - Quick find and AI dictation and translations are triggered through shell-level custom browser events.

- **Third-party integrations**
  - Clerk handles authentication.
  - Sentry handles frontend monitoring and browser tracing.
  - Resend handles transactional email.
  - Dodo Payments handles checkout, subscriptions, plan changes, and webhooks.
  - OpenRouter powers AI dictation processing and AI chat responses.
  - Neon/PostgreSQL is accessed through Cloudflare Hyperdrive.

- **Build and quality scripts**
  - `pnpm dev` runs Wrangler with variables loaded from `.dev.vars`.
  - `pnpm dev:vite` runs the Vite dev server with `/api` proxied to Wrangler on port `8787`.
  - `pnpm dev:full` runs Wrangler and Vite together.
  - `pnpm build` runs TypeScript build checks and Vite production build.
  - `pnpm lint` runs ESLint.
  - `pnpm format` and `pnpm format:check` run Prettier.
  - `pnpm deploy` deploys through Wrangler.

- **Copy-this-architecture checklist for a new app**
  - Keep `app/` as the React SPA boundary and `functions/api/` as the worker API boundary.
  - Keep file-based TanStack Router for pages and product sections.
  - Keep `app/lib/api.ts` as the only low-level browser fetch wrapper.
  - Put server-only integration code in `api/_lib/`, not in `app/`.
  - Use Zod for every API input boundary.
  - Use TanStack Query hooks as the normal component-facing data API.
  - Use context for shell/UI state, not remote data.
  - Keep auth middleware responsible for token verification and local user provisioning.
  - Centralize authorization, tier limits, and feature gates in server helpers.
  - Keep the database schema and migrations in `db/`.
  - Keep API routes under `/api/*` and avoid service-worker caching for them.
  - Treat Cloudflare bindings and secrets as runtime configuration, typed through `api/_lib/env.ts`.
