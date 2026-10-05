# CLOUDFLARE.md

> Deployment process and environments are in [DEPLOYMENT.md](./DEPLOYMENT.md). This doc is the platform reference: the worker, its bindings, and request routing.

## Worker

- Entry point: [`functions/api/[[route]].ts`](../functions/api/[[route]].ts), a one-line re-export of the Hono app in `api/app.ts`.
- `wrangler.jsonc` (JSONC, validated against `node_modules/wrangler/config-schema.json`):
  - `name: "vibe-translate"`, `main: "functions/api/[[route]].ts"`
  - `account_id` pins **the production Cloudflare account** (`c03f9623…`) — the account that owns the `marrowtech.app` zone. The wrangler login can see two accounts, so this is required for non-interactive commands.
  - `compatibility_date: "2026-10-01"`, `compatibility_flags: ["nodejs_compat"]` — `nodejs_compat` is required for the `pg` driver and Node built-ins used by the server helpers.
  - `observability.enabled` — Workers Logs on, 100% head sampling (`wrangler tail` for live logs).
  - `placement: { mode: "targeted", region: "aws:ap-southeast-1" }` — **Targeted Placement** runs the Worker beside the Neon DB (AWS Singapore). An auth or API request makes several sequential queries. The `marrowtech.app` zone is on the free plan, so APAC traffic was often served from SJC, and every query crossed the Pacific. Sign-in dropped from ~2–3 s to ~0.9 s after the change. Responses carry `cf-placement: remote-SIN`. Only Worker invocations (`/api/*`) move; static assets are still served at the edge.

## Bindings

### ASSETS (static SPA)

```jsonc
"assets": {
  "directory": "./dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"],
}
```

- Serves the Vite build from `dist/`.
- `single-page-application` fallback: any unmatched path returns `index.html` so TanStack Router client routes resolve. API routes are matched first (see Routing).

### Hyperdrive (Postgres) {#hyperdrive}

Production binds Hyperdrive to the production Neon database:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "651eb586c0de4e9596c954f951ddcd05" }]
```

- Hyperdrive config **`vibe-translate-prod`** (production account) points at the production Neon DB, which lives in AWS `ap-southeast-1` (Singapore). The Worker's placement targets that region (see [Worker](#worker)). (`domarrow-hyperdrive` in the same account belongs to another project — don't reuse it.)
- `api/_lib/db.ts` reads `env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL`. In production that is Hyperdrive, used for **connection pooling only**. Query caching is **disabled** on `vibe-translate-prod`, because cached reads would serve stale sessions (e.g. after sign-out) and stale lists after writes. Keep it off.
- **Local dev:** `wrangler dev` refuses to start with a Hyperdrive binding and no local connection string. It reads `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` from a gitignored **`.env`** (Wrangler CLI env — `.dev.vars` does _not_ work for this). Set it to the same local Neon URL as `DATABASE_URL`.
- The bound Neon database must have `pgvector` enabled (translation memory depends on it).
- Rotating the Neon password: `wrangler hyperdrive update <id> --origin-password …` — no redeploy needed.

### Environment variables & secrets

- Non-secret vars in `vars`: `APP_ENV=production`, `APP_URL=https://translate.marrowtech.app`. `.dev.vars` overrides both locally (`development`, `http://localhost:5173`).
- `APP_URL` is also Better Auth's `baseURL` and sole trusted origin (`api/_lib/auth.ts`). Auth requests from any other `Origin` get `403 INVALID_ORIGIN`, and the Google redirect URI is `<APP_URL>/api/auth/callback/google`.
- Secrets via `wrangler secret put` (see [DEPLOYMENT.md](./DEPLOYMENT.md#secrets)). The full typed binding surface is in [`api/_lib/env.ts`](../api/_lib/env.ts).

## Request routing

For a request to the worker:

1. `/api/*` is handled by the Hono app first (`run_worker_first`). `/api/auth/*` goes to Better Auth's handler. Everything else passes the `auth()` session guard where applicable, then validation, then the handlers.
2. Everything else falls through to the `ASSETS` binding, which serves static files or the SPA fallback (`index.html`).

So `/api/health` hits the worker; `/app/oba-chan` returns `index.html` and the client router takes over.

## Edge security controls

- **CORS** is set in `api/app.ts` to allow the `APP_URL` origin with credentials and only the `content-type` header. Auth is the same-origin session cookie, with no `authorization` header.
- **Rate limiting**: Cloudflare Rate Limiting Rules / WAF on `/api/*` are the coarse first layer. Per-user **credits** are the fine layer, and Better Auth's Postgres-backed limits (production only) cover `/api/auth/*`. See [SECURITY.md](./SECURITY.md#abuse-protection--rate-limiting). These are configured in the Cloudflare dashboard, not in `wrangler.jsonc`.
- The metered `POST /api/ai/text-to-speech` route is authenticated; the landing demo uses static clips instead of hitting it anonymously.

## Custom domain

`translate.marrowtech.app` is a **Workers Custom Domain**, declared in `wrangler.jsonc` (`routes: [{ pattern, custom_domain: true }]`). `wrangler deploy` creates the DNS record and certificate itself — no manual DNS entry. `workers_dev` and `preview_urls` are off, so the custom domain is the only public entry point. `APP_URL` matches it so CORS, share links, Better Auth's trusted origin and the Google redirect URI line up.

## Service worker interaction

`public/sw.js` (the PWA service worker) is served as a static asset. It is configured to **never cache `/api/*`** so authenticated responses are never served stale. Static assets are cache-first; navigations are network-first with cached fallback. See [FRONTEND.md](./FRONTEND.md#offline--cache).

## Local dev vs deployed

|                       | Local (`wrangler dev`)                                                  | Production (`wrangler deploy`)                                |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| DB                    | local Neon (Hyperdrive binding emulated via `.env`)                     | Hyperdrive `vibe-translate-prod` (no query cache) → prod Neon |
| Secrets               | `.dev.vars`                                                             | `wrangler secret put` / `secret bulk`                         |
| `VITE_*` (build-time) | `.dev.vars` (copied by `vite.config.ts`)                                | none needed (the `.dev.vars` copy is skipped)                 |
| Auth emails           | logged by the worker (`[auth] … → email: url`) when no `RESEND_API_KEY` | sent via Resend                                               |
| Auth rate limits      | off                                                                     | on (Postgres `auth_rate_limits`)                              |
| Placement             | local                                                                   | targeted `aws:ap-southeast-1` (beside the DB)                 |
| Assets                | Vite dev server (`pnpm dev:vite`) or built `dist/`                      | `dist/` via ASSETS                                            |
| `APP_ENV`             | `development`                                                           | `production`                                                  |
