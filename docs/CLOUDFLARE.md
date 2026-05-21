# CLOUDFLARE.md

> Deployment process and environments are in [DEPLOYMENT.md](./DEPLOYMENT.md). This doc is the platform reference: the worker, its bindings, and request routing.

## Worker

- Entry point: [`functions/api/[[route]].ts`](../functions/api/[[route]].ts), a one-line re-export of the Hono app in `api/app.ts`.
- `wrangler.toml`:
  - `name = "vibe-translate"`
  - `main = "functions/api/[[route]].ts"`
  - `compatibility_date = "2025-01-21"`, `compatibility_flags = ["nodejs_compat"]` — `nodejs_compat` is required for the `pg` driver and Node built-ins used by the server helpers.

## Bindings

### ASSETS (static SPA)

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

- Serves the Vite build from `dist/`.
- `single-page-application` fallback: any unmatched path returns `index.html` so TanStack Router client routes resolve. API routes are matched first (see Routing).

### Hyperdrive (Postgres) {#hyperdrive}

Production binds Hyperdrive to the production Neon database:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-production-hyperdrive-id"
localConnectionString = "postgres://user:password@localhost:5432/vibe_translate"
```

- `api/_lib/db.ts` reads `env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL`. In production it uses Hyperdrive (connection pooling + edge caching); locally, with no Hyperdrive binding, it falls back to `DATABASE_URL` from `.dev.vars`.
- The bound Neon database must have `pgvector` enabled (translation memory depends on it).
- Committed `wrangler.toml` keeps this block commented; uncomment + set the real `id` before deploying.

### Environment variables & secrets

- Non-secret vars in `[vars]`: `APP_ENV`, `APP_URL`.
- Secrets via `wrangler secret put` (see [DEPLOYMENT.md](./DEPLOYMENT.md#secrets)). The full typed binding surface is in [`api/_lib/env.ts`](../api/_lib/env.ts).

## Request routing

For a request to the worker:

1. `/api/*` is handled by the Hono app first (auth, validation, handlers).
2. Everything else falls through to the `ASSETS` binding, which serves static files or the SPA fallback (`index.html`).

So `/api/health` hits the worker; `/app/oba-chan` returns `index.html` and the client router takes over.

## Edge security controls

- **CORS** is set in `api/app.ts` to allow the `APP_URL` origin with credentials.
- **Rate limiting**: Cloudflare Rate Limiting Rules / WAF on `/api/*` are the coarse first layer; per-user **credits** are the fine layer. See [SECURITY.md](./SECURITY.md#abuse-protection--rate-limiting). These are configured in the Cloudflare dashboard, not in `wrangler.toml`.
- The metered `POST /api/ai/text-to-speech` route is authenticated; the landing demo uses static clips instead of hitting it anonymously.

## Custom domain

Mapped via **Workers routes** in the Cloudflare dashboard (the zone's DNS is in Cloudflare). Point the production hostname at the `vibe-translate` worker and set `APP_URL` to match so CORS lines up.

## Service worker interaction

`public/sw.js` (the PWA service worker) is served as a static asset. It is configured to **never cache `/api/*`** so authenticated responses are never served stale. Static assets are cache-first; navigations are network-first with cached fallback. See [FRONTEND.md](./FRONTEND.md#offline--cache).

## Local dev vs deployed

| | Local (`wrangler dev`) | Production (`wrangler deploy`) |
| --- | --- | --- |
| DB | `DATABASE_URL` (local Neon) | Hyperdrive → prod Neon |
| Secrets | `.dev.vars` | `wrangler secret put` |
| Assets | Vite dev server (`pnpm dev:vite`) or built `dist/` | `dist/` via ASSETS |
| `APP_ENV` | `development` | `production` |
