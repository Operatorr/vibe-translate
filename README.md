# VibeTranslate

Single-page React app with a Cloudflare Workers API, following the architecture in
`architecute.md`.

## Quick Start

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.dev.vars` and fill in Clerk/database secrets.
3. Run `pnpm dev` for Wrangler or `pnpm dev:full` for Wrangler plus Vite.
4. Build with `pnpm build`.

## Project Layout

- `app/` contains the React 19, Vite, TanStack Router, TanStack Query frontend.
- `functions/api/[[route]].ts` is the Cloudflare Worker entry.
- `api/_lib/` contains server-only auth, validation, env, tier, and integration helpers.
- `db/` contains the canonical schema and migrations.
- `public/` contains PWA and SEO assets.
