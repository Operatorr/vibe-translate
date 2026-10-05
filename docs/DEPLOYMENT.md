# DEPLOYMENT.md

> Platform specifics (bindings, routes, SPA fallback) are in [CLOUDFLARE.md](./CLOUDFLARE.md). Secret handling rationale is in [SECURITY.md](./SECURITY.md).

## Environments

Two environments only — **Local** and **Production**. There is no staging tier.

|           | Local                                             | Production                                   |
| --------- | ------------------------------------------------- | -------------------------------------------- |
| Runtime   | `wrangler dev` / Vite                             | Cloudflare Workers                           |
| Config    | `wrangler.jsonc` + `.dev.vars` + `.env` overrides | `wrangler.jsonc` + `wrangler secret`s        |
| `APP_ENV` | `development` (set in `.dev.vars`)                | `production` (in `wrangler.jsonc`)           |
| URL       | `http://localhost:5173`                           | `https://translate.marrowtech.app`           |
| Database  | local Neon database, direct via `DATABASE_URL`    | production Neon database, via **Hyperdrive** |
| pgvector  | enabled on the local Neon DB                      | enabled on the prod Neon DB                  |

The committed `wrangler.jsonc` **is the production config**. Local dev overrides what it needs through `.dev.vars` (worker vars/secrets) and `.env` (Wrangler CLI env — the local Hyperdrive stand-in).

## Build

`pnpm build` runs `tsc --noEmit && vite build`:

- `tsc --noEmit` type-checks both the SPA and the worker (no emit — Wrangler bundles the worker itself).
- `vite build` produces the static SPA into `dist/`, which the worker serves via the `ASSETS` binding.
- The SPA needs **no build-time keys**: auth is same-origin, so there's no publishable key to embed, and there is no `.env.production`. `vite.config.ts` still skips copying `.dev.vars` `VITE_*` keys in production mode, so a local-only value can never be baked into the bundle.

## Local development

1. `pnpm install`.
2. Copy `.env.example` → `.dev.vars` and fill in secrets: `BETTER_AUTH_SECRET` (required, `openssl rand -base64 32`), `CREDENTIALS_ENCRYPTION_KEY`, provider keys, and `DATABASE_URL` for the **local** Neon DB. Keep `APP_ENV=development` and `APP_URL=http://localhost:5173`. Vite reads `VITE_*` keys from `.dev.vars` (Wrangler reads the rest).
   - **Google sign-in (optional):** set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from a Google OAuth client with the authorized redirect URI `http://localhost:5173/api/auth/callback/google`. Without them, email + password still works and the Google button errors.
   - **Auth emails:** with no `RESEND_API_KEY` (and `APP_ENV` ≠ `production`), verification and reset emails are **not sent**. The worker logs `[auth] <subject> → <email>: <url>` instead, so open that link to verify. Auth rate limits are off locally.
3. Create a gitignored `.env` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=<same URL as DATABASE_URL>` — `wrangler dev` won't start without a local stand-in for the Hyperdrive binding.
4. Ensure the local Neon DB has the schema (see Migrations below) and `pgvector` enabled.
5. Run `pnpm dev:full` (Wrangler worker + Vite together). `pnpm dev` is worker-only; `pnpm dev:vite` is the SPA with `/api` proxied to Wrangler on `:8787`.

> The user typically already has `pnpm dev:full` running in another terminal — use the running server for localhost verification rather than starting another.

## Secrets

- **Real secrets** (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_*`, `CREDENTIALS_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_*`, `DODO_*`, `RESEND_API_KEY`/`RESEND_FROM`) are set in production with `wrangler secret put <NAME>` — encrypted in Cloudflare, never committed.
- **Non-sensitive vars** (`APP_ENV`, `APP_URL`) live in `wrangler.jsonc` `vars`.
- **Locally**, everything goes in `.dev.vars` (gitignored). `.env.example` is the checked-in template.

Production uses its **own** `BETTER_AUTH_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`, never the local values. Rotating `BETTER_AUTH_SECRET` invalidates every session cookie and signs everyone out. Rotating `CREDENTIALS_ENCRYPTION_KEY` means re-encrypting every stored BYOK cipher. Auth email is load-bearing: production needs `RESEND_API_KEY` + `RESEND_FROM` on a Resend-verified domain, or no one can verify an email (and so no one can finish a password sign-up). Dodo is unset until live payments launch, and checkout returns 503 until then.

Provisioned secrets (`wrangler secret list` to audit):

```
wrangler secret put BETTER_AUTH_SECRET           # openssl rand -base64 32 — prod-only
wrangler secret put CREDENTIALS_ENCRYPTION_KEY   # openssl rand -base64 32 — prod-only
wrangler secret put RESEND_API_KEY               # required: auth emails
wrangler secret put RESEND_FROM                  # sender on the Resend-verified domain
wrangler secret put GOOGLE_CLIENT_ID             # Google OAuth (production client)
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put OPENROUTER_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put ELEVENLABS_VOICE_YAKUZA      # ...and the other 5 voices
# Optional: ELEVENLABS_MODEL_ID, *_MODEL / *_REASONING overrides
# At payments launch: DODO_API_KEY, DODO_WEBHOOK_SECRET, DODO_PRODUCT_* (live mode)
```

For many at once, `wrangler secret bulk <file.json>` from a temp file outside the repo, then delete it.

The Google OAuth client's authorized redirect URIs are `https://translate.marrowtech.app/api/auth/callback/google` (production) and `http://localhost:5173/api/auth/callback/google` (local). Use separate clients or list both on one client.

## Database migrations

**Manual, via the Neon SQL Editor.** There is no migration runner.

1. For a fresh database: paste [`db/migrations/0001_initial.sql`](../db/migrations) into the Neon SQL Editor and run it (it bootstraps at the current 1536-dim embedding schema), then apply each later migration in order (`0002`…`0006`). All are idempotent (`create … if not exists`, `on conflict do nothing`, type-guarded `alter`s).
2. For incremental changes: author `db/migrations/000N_<slug>.sql`, keep [`db/schema.sql`](../db/schema.sql) in sync as the canonical bootstrap, and paste the new migration into the Neon SQL Editor for each environment (local DB, then prod DB). **Never edit an already-applied migration in place** — `create … if not exists` means a re-run won't alter existing objects, so a forward migration is the only thing that reaches provisioned databases (e.g. `0004_embed_dims_1536.sql` migrates a pre-1536 DB's `vector(3072)` columns down to 1536).
3. `pgvector` must be enabled (`create extension if not exists vector;` — included in the migration).

Apply to the **local** Neon DB and the **production** Neon DB separately, since they are distinct databases.

## Deploy

1. Apply any pending migration to the production Neon DB (above).
2. `pnpm run deploy` — runs `pnpm build` then `wrangler deploy`. (Use `pnpm run deploy`: bare `pnpm deploy` is pnpm's own workspace command.)
3. Smoke-test: `curl https://translate.marrowtech.app/api/health` → `{"ok":true,"env":"production"}`. Then sign up with email, open the verification link (this needs Resend configured), translate once, sign out, and sign back in (and once with Google). `wrangler tail` for live logs. API responses carry `cf-placement: remote-SIN`, which shows the worker ran next to the DB ([CLOUDFLARE.md](./CLOUDFLARE.md#worker)).

## Custom domain

`translate.marrowtech.app` is a Workers Custom Domain declared in `wrangler.jsonc`; `wrangler deploy` provisions its DNS record and certificate. `APP_URL` (CORS origin, share links, Better Auth `baseURL` and trusted origin, the Google redirect URI) must match it. See [CLOUDFLARE.md](./CLOUDFLARE.md#custom-domain).

## Rollback

Use Cloudflare's version history: `wrangler rollback` (or pin a prior version via `wrangler versions`). Prefer this over redeploying from git — it's instant and doesn't depend on a clean rebuild. Note: a rollback reverts **code only**, not database migrations. Migrations are designed to be additive; avoid destructive DDL that a code rollback couldn't tolerate.

## Pre-launch checklist

- [x] Production Neon DB created, `pgvector` enabled, all migrations (`0001`…`0006`) applied in order.
- [x] Hyperdrive `vibe-translate-prod` created against the prod Neon DB (query caching **disabled**) and bound in `wrangler.jsonc`.
- [x] Deployed (`pnpm run deploy`) to `https://translate.marrowtech.app`; `APP_URL` matches.
- [x] Secrets set: `BETTER_AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `TRANSLATE_MODEL`/`TRANSLATE_REASONING`, `EXPLAIN_MODEL`/`EXPLAIN_REASONING`, `ELEVENLABS_MODEL_ID`.
- [ ] ⚠ `RESEND_API_KEY` + `RESEND_FROM` on a Resend-verified domain. Until then, no one can verify an email, so password sign-up can't complete.
- [ ] Google OAuth production client (redirect URI `https://translate.marrowtech.app/api/auth/callback/google`); `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set.
- [ ] `ELEVENLABS_API_KEY` + the six `ELEVENLABS_VOICE_*` ids.
- [x] Dodo webhook signature verification wired (see [SECURITY.md](./SECURITY.md#webhook-signatures)) — launch blocker. Set `DODO_WEBHOOK_SECRET` (and the `DODO_PRODUCT_*` ids) before go-live. Payments are intentionally off until then.
- [ ] Six `public/demo/vibe-*.mp3` clips rendered (see [public/demo/README.md](../public/demo/README.md)).
