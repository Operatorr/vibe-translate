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
- **Non-sensitive vars** (`APP_ENV`, `APP_URL`) live in `wrangler.jsonc` `vars`. Model and reasoning overrides are dashboard-managed **Text** variables under **Settings → Variables & Secrets**. `keep_vars: true` preserves them across Git and CLI deployments; keep these overrides out of the committed `vars` block so dashboard edits remain authoritative.

Dashboard Text overrides:

```dotenv
TRANSLATE_MODEL=x-ai/grok-4.3
TRANSLATE_REASONING=none
EXPLAIN_MODEL=x-ai/grok-4.3
EXPLAIN_REASONING=none
DICTATION_MODEL=
DICTATION_REASONING=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Blank model/reasoning overrides can be left unset. Models then use the database registry default, and reasoning uses the provider default. For existing overrides stored as Secrets, change their Type to Text and enter the desired value in the dashboard, then Deploy. `keep_vars` preserves Text values but does not convert existing Secrets.

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
# Model/reasoning overrides are dashboard Text variables (see above).
# At payments launch: DODO_API_KEY, DODO_WEBHOOK_SECRET, DODO_PRODUCT_* (live mode)
```

For many at once, `wrangler secret bulk <file.json>` from a temp file outside the repo, then delete it.

The Google OAuth client's authorized redirect URIs are `https://translate.marrowtech.app/api/auth/callback/google` (production) and `http://localhost:5173/api/auth/callback/google` (local). Use separate clients or list both on one client.

## Database migrations

Use **`pnpm db:migrate`**. The runner uses the existing `pg` dependency and Node runs its TypeScript entrypoint directly, so it needs **Node 22.18.0 or later** (the first 22.x release that strips types by default; `engines` in `package.json` records this). SQL files live in [`db/migrations/`](../db/migrations), operational options in [`db/migrations.json`](../db/migrations.json), and execution logic in [`scripts/db-migration-runner.ts`](../scripts/db-migration-runner.ts).

```sh
pnpm db:migrate                      # apply pending Local migrations
pnpm db:migrate --status             # inspect Local history; read-only
pnpm db:migrate --production         # apply pending Production migrations
pnpm db:migrate --production --status
```

- **Local is the default.** The runner reads the local Hyperdrive connection string from `.env`, or `DATABASE_URL` from `.dev.vars`. `MIGRATION_DATABASE_URL` in the shell or `.env.local` overrides that choice. Ambient `DATABASE_URL` is deliberately not used as an implicit Production target. The opt-in database tests resolve Local the same way.
- **Production is explicit.** Set `PRODUCTION_DATABASE_URL` in the gitignored `.env.production.local`, or provide that variable through CI's secret environment. It never falls back to Local. The host **and database** must match [`db/targets.json`](../db/targets.json), whose nonsecret target mirrors the verified production Hyperdrive origin. Update that file if the origin is intentionally moved. Do not put a URL/password in command arguments or commit credentials.
- **Direct connections.** Use Neon's non-pooled connection string. For existing Local/Production Neon pooled URLs, the runner removes the `-pooler` hostname suffix and uses the same endpoint/database/credentials directly. It enforces certificate verification and enables channel binding. Session advisory locks require a direct connection; the app's pooled runtime configuration is unchanged. See [Neon's connection guidance](https://neon.com/docs/connect/connection-pooling).
- **Connection guard.** The checks apply to the target `pg` actually connects to. `pg` lets query parameters such as `host`, `port`, `user` or `options` (Neon endpoint routing) override the URL, so only `sslmode`, `channel_binding` and `application_name` are accepted. The URL must name a DNS host and a database; a missing port becomes `5432` instead of ambient `PGPORT`. Hosts are compared case-insensitively without a trailing dot, and Local also refuses any Neon host carrying the Production endpoint ID.
- **Tracked history.** `public.schema_migrations` records filename, SHA-256 checksum, application timestamp, duration, and whether an entry was baselined. The checksum includes SQL plus effective transaction/verification options. Successful files are skipped; changed/missing applied files and gaps in history fail before migration execution. Never edit an applied SQL file or its effective metadata; add a new forward migration. The tracker is managed by the runner, not by the domain bootstrap SQL.
- **Transactions and locking.** Each ordinary file and its tracking row commit together. Failure rolls that file back; earlier successful files remain applied. A session advisory lock (`MIGRATION_LOCK` in the runner; never change its key) excludes another runner targeting the same database. DDL lock acquisition times out after five seconds; statement execution after thirty minutes. A connection failure exits nonzero, and closing the session releases its lock. If rollback, unlock or disconnect also fails, the output lists that failure after the original error.
- **Concurrent indexes.** Set `transaction: false` in `db/migrations.json` for files that need to run outside transactions; the loader rejects concurrent index DDL (and `DETACH PARTITION … CONCURRENTLY`) in a transactional file, ignoring mentions in comments and literals. Statements are split where psql would split them (quotes, dollar bodies with any tag, nested comments, parentheses and `BEGIN ATOMIC` routine bodies) and sent separately, avoiding implicit multi-statement transactions. Such SQL must be safe to retry after a partial failure. `0008` also verifies the exact index definition and `indisvalid`/`indisready` before recording success. `IF NOT EXISTS` cannot repair an invalid index; [recover it](#recovering-an-invalid-concurrent-index), then rerun. The runner never drops an existing index itself.

### Existing databases and fresh setup

Local and Production were adopted on **2026-10-08** after schema inspection. `0001`–`0004` were recorded as the audited baseline, then `0005`–`0008` executed normally. This repaired missing share/user and auth-account indexes; Production's live links and duplicate account groups were both zero before execution. `0008` ran separately, outside a transaction, and its exact definition/validity passed verification. A second Production run executed no migration SQL.

For a **fresh empty database**, run the command normally; all numbered files execute in order, including the `pgvector` extension. Keep [`db/schema.sql`](../db/schema.sql) in sync as the canonical domain schema, but use migrations to provision databases so history is recorded.

For another **existing manually managed database**, the runner refuses to replay historical SQL automatically. Audit which prefix is already applied, then adopt that prefix once:

```sh
pnpm db:migrate --baseline 0004
# Or, for the explicitly configured Production target:
pnpm db:migrate --production --baseline 0004
```

`--baseline` is an **operator assertion**, not an automatic schema-equivalence check: it records that prefix without executing it, then executes the remaining files. Choose the last contiguous migration whose effects have actually been verified; do not copy `0004` blindly. Once any history exists, baseline is rejected. After a subsequent failure, resume with the ordinary command **without** `--baseline`.

### Authoring and verification

Name new files `000N_<slug>.sql` (unique four-digit numbers), maintain the schema snapshot, and do not include your own transaction control in ordinary files. Declare nontransactional options explicitly, and add `verifySql` where a postcondition is needed. It must return a boolean `ok` column whose first row is exactly `true`; `false`, `NULL`, text such as `'true'`, a missing column or no row all fail without recording the file. Metadata keys other than `transaction` and `verifySql` are rejected. Test on Local before applying Production. Application deployment does not run migrations automatically.

Runner unit tests are included in `pnpm test`. The optional real database test creates and deletes one separate disposable **Local database**, so its role needs `CREATEDB`:

```sh
RUN_LOCAL_DB_MIGRATIONS=1 pnpm exec vitest run scripts/db-migration-integration.test.ts
```

It verifies fresh provisioning, unchanged reruns, concurrent-run exclusion, transactional rollback, and the invalid-concurrent-index retry case. It reads `.dev.vars`, `.env` and `.env.local` itself, exactly like `pnpm db:migrate`, so no `--env-file` flags are needed. It refuses the configured Production host and never uses Production credentials.

### Recovering an invalid concurrent index

A failed `CREATE INDEX CONCURRENTLY` can leave an invalid index behind. The file stays pending, and on retry `IF NOT EXISTS` skips the broken index, so verification keeps failing. On the target that failed:

1. Confirm no build is still running. An index under construction is also invalid, so this query must return no row for its table or index:

   ```sql
   select pid, phase, relid::regclass, index_relid::regclass from pg_stat_progress_create_index;
   ```

2. Inspect the index the file creates (`0008`'s shown):

   ```sql
   select c.oid::regclass as index, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
   from pg_index i
   join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'segments_user_thread_created_id_idx';
   ```

3. Continue only if this is the file's index and it is unusable: `indisvalid` or `indisready` is false, and the definition matches the file's `CREATE INDEX`. If it is valid, do not drop it: a matching definition means the verification query is wrong, and a different one means something else owns that name.
4. Drop the confirmed index on its own, outside a transaction (psql autocommit; no `BEGIN`, no other statements):

   ```sql
   drop index concurrently public.segments_user_thread_created_id_idx;
   ```

5. Fix the cause from the runner's error (for example duplicate rows under a unique index, or a lock timeout), then rerun the same command: `pnpm db:migrate` for Local, `pnpm db:migrate --production` for Production.

## Deploy

1. `pnpm db:migrate --production` — apply pending migrations to the production Neon DB (above).
2. `pnpm run deploy` — runs `pnpm build` then `wrangler deploy`. (Use `pnpm run deploy`: bare `pnpm deploy` is pnpm's own workspace command.)
3. Smoke-test: `curl https://translate.marrowtech.app/api/health` → `{"ok":true,"env":"production"}`. Then sign up with email, open the verification link (this needs Resend configured), translate once, sign out, and sign back in (and once with Google). `wrangler tail` for live logs. API responses carry `cf-placement: remote-SIN`, which shows the worker ran next to the DB ([CLOUDFLARE.md](./CLOUDFLARE.md#worker)).

## Custom domain

`translate.marrowtech.app` is a Workers Custom Domain declared in `wrangler.jsonc`; `wrangler deploy` provisions its DNS record and certificate. `APP_URL` (CORS origin, share links, Better Auth `baseURL` and trusted origin, the Google redirect URI) must match it. See [CLOUDFLARE.md](./CLOUDFLARE.md#custom-domain).

## Rollback

Use Cloudflare's version history: `wrangler rollback` (or pin a prior version via `wrangler versions`). Prefer this over redeploying from git — it's instant and doesn't depend on a clean rebuild. Note: a rollback reverts **code only**, not database migrations. Migrations are designed to be additive; avoid destructive DDL that a code rollback couldn't tolerate.

## Pre-launch checklist

- [x] `0007_auth_account_uniqueness.sql` and `0008_segment_pagination.sql` applied and tracked in Production (2026-10-08).
- [x] Production Neon DB created, `pgvector` enabled, migration history adopted and all migrations through `0008` recorded.
- [x] Hyperdrive `vibe-translate-prod` created against the prod Neon DB (query caching **disabled**) and bound in `wrangler.jsonc`.
- [x] Deployed (`pnpm run deploy`) to `https://translate.marrowtech.app`; `APP_URL` matches.
- [x] Secrets set: `BETTER_AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`; model/reasoning overrides were initially provisioned as Secrets and should be converted to dashboard Text variables (see above).
- [ ] ⚠ `RESEND_API_KEY` + `RESEND_FROM` on a Resend-verified domain. Until then, no one can verify an email, so password sign-up can't complete.
- [ ] Google OAuth production client (redirect URI `https://translate.marrowtech.app/api/auth/callback/google`); `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set.
- [ ] `ELEVENLABS_API_KEY` + the six `ELEVENLABS_VOICE_*` ids.
- [x] Dodo webhook signature verification wired (see [SECURITY.md](./SECURITY.md#webhook-signatures)) — launch blocker. Set `DODO_WEBHOOK_SECRET` (and the `DODO_PRODUCT_*` ids) before go-live. Payments are intentionally off until then.
- [ ] Six `public/demo/vibe-*.mp3` clips rendered (see [public/demo/README.md](../public/demo/README.md)).
