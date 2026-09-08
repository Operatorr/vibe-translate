# DEPLOYMENT.md

> Platform specifics (bindings, routes, SPA fallback) are in [CLOUDFLARE.md](./CLOUDFLARE.md). Secret handling rationale is in [SECURITY.md](./SECURITY.md).

## Environments

Two environments only — **Local** and **Production**. There is no staging tier.

| | Local | Production |
| --- | --- | --- |
| Runtime | `wrangler dev` / Vite | Cloudflare Workers |
| Config | top-level `wrangler.toml` + `.dev.vars` overrides | top-level `wrangler.toml` |
| `APP_ENV` | `development` (set in `.dev.vars`) | `production` (in `wrangler.toml`) |
| Database | local Neon database, direct via `DATABASE_URL` | production Neon database, via **Hyperdrive** |
| pgvector | enabled on the local Neon DB | enabled on the prod Neon DB |

The committed `wrangler.toml` **is the production config**. Local dev overrides what it needs through `.dev.vars`.

## Build

`pnpm build` runs `tsc --noEmit && vite build`:

- `tsc --noEmit` type-checks both the SPA and the worker (no emit — Wrangler bundles the worker itself).
- `vite build` produces the static SPA into `dist/`, which the worker serves via the `ASSETS` binding.

## Local development

1. `pnpm install`.
2. Copy `.env.example` → `.dev.vars` and fill in secrets (Clerk, `CREDENTIALS_ENCRYPTION_KEY`, provider keys, and `DATABASE_URL` for the **local** Neon DB). Set `APP_ENV=development`. Vite reads `VITE_*` keys from `.dev.vars` (Wrangler reads the rest).
3. Ensure the local Neon DB has the schema (see Migrations below) and `pgvector` enabled.
4. Run `pnpm dev:full` (Wrangler worker + Vite together). `pnpm dev` is worker-only; `pnpm dev:vite` is the SPA with `/api` proxied to Wrangler on `:8787`.

> The user typically already has `pnpm dev:full` running in another terminal — use the running server for localhost verification rather than starting another.

## Secrets

- **Real secrets** (Clerk keys, `CREDENTIALS_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_*`, `DODO_*`, `RESEND_API_KEY`) are set in production with `wrangler secret put <NAME>` — encrypted in Cloudflare, never committed.
- **Non-sensitive vars** (`APP_ENV`, `APP_URL`) live in `wrangler.toml [vars]`.
- **Locally**, everything goes in `.dev.vars` (gitignored). `.env.example` is the checked-in template.

Provision before first production deploy:

```
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_PUBLISHABLE_KEY
wrangler secret put CREDENTIALS_ENCRYPTION_KEY   # openssl rand -base64 32
wrangler secret put OPENROUTER_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put ELEVENLABS_VOICE_YAKUZA      # ...and the other 5 voices
wrangler secret put DODO_API_KEY
wrangler secret put DODO_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
```

## Database migrations

**Manual, via the Neon SQL Editor.** There is no migration runner.

1. For a fresh database: paste [`db/migrations/0001_initial.sql`](../db/migrations) into the Neon SQL Editor and run it (it bootstraps at the current 1536-dim embedding schema), then apply each later migration in order (`0002`…`0005`). All are idempotent (`create … if not exists`, `on conflict do nothing`, type-guarded `alter`s).
2. For incremental changes: author `db/migrations/000N_<slug>.sql`, keep [`db/schema.sql`](../db/schema.sql) in sync as the canonical bootstrap, and paste the new migration into the Neon SQL Editor for each environment (local DB, then prod DB). **Never edit an already-applied migration in place** — `create … if not exists` means a re-run won't alter existing objects, so a forward migration is the only thing that reaches provisioned databases (e.g. `0004_embed_dims_1536.sql` migrates a pre-1536 DB's `vector(3072)` columns down to 1536).
3. `pgvector` must be enabled (`create extension if not exists vector;` — included in the migration).

Apply to the **local** Neon DB and the **production** Neon DB separately, since they are distinct databases.

## Deploy

1. `pnpm build`.
2. Apply any pending migration to the production Neon DB (above).
3. Ensure the Hyperdrive binding in `wrangler.toml` is uncommented and points at the production Neon DB (see [CLOUDFLARE.md](./CLOUDFLARE.md#hyperdrive)).
4. `pnpm deploy` (`wrangler deploy`).

## Custom domain

Mapped via **Cloudflare Workers routes** (the zone's DNS lives in Cloudflare). Configure the route to point the production hostname at the `vibe-translate` worker. `APP_URL` (the CORS origin) must match the production hostname.

## Rollback

Use Cloudflare's version history: `wrangler rollback` (or pin a prior version via `wrangler versions`). Prefer this over redeploying from git — it's instant and doesn't depend on a clean rebuild. Note: a rollback reverts **code only**, not database migrations. Migrations are designed to be additive; avoid destructive DDL that a code rollback couldn't tolerate.

## Pre-launch checklist

- [ ] Production Neon DB created, `pgvector` enabled, all migrations (`0001`…`0005`) applied in order.
- [ ] Hyperdrive configured against the prod Neon DB; binding uncommented in `wrangler.toml`.
- [ ] All production secrets set via `wrangler secret put` (esp. `CREDENTIALS_ENCRYPTION_KEY` before BYOK is usable).
- [x] Dodo webhook signature verification wired (see [SECURITY.md](./SECURITY.md#webhook-signatures)) — launch blocker. Set `DODO_WEBHOOK_SECRET` (and the `DODO_PRODUCT_*` ids) before go-live.
- [ ] Six `public/demo/vibe-*.mp3` clips rendered (see [public/demo/README.md](../public/demo/README.md)).
- [ ] Custom domain route mapped; `APP_URL` set to match.
