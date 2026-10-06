---
status: accepted
---

# Better Auth (self-hosted) replaces Clerk

Clerk's free tier ends every session after 7 days, however active the user is. A learner who opens the app daily had to sign in again every week, which is the wrong kind of friction for a habit product.

We replaced Clerk with **Better Auth**, running inside our own Worker against our own Postgres. Identity lives in the `auth_*` tables next to the data it owns. There is no per-MAU vendor, no external JS SDK or CDN script, and no third-party DNS. The SPA calls `/api/auth/*` on the same origin, and the session is an httpOnly cookie: no token is ever visible to JavaScript, and `app/lib/api.ts` sends no `Authorization` header.

## Methods

Email + password (min 8 chars) with **required** email verification, password reset by email, and Google OAuth (`prompt=select_account`). A sign-up sends the verification link. Signing in while unverified re-sends it instead of dead-ending (`sendOnSignIn`), and opening it signs the user in (`autoSignInAfterVerification`). A password reset revokes every session. Google is enabled only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. Auth emails go out through Resend (`email.ts → verifyEmailContent` / `resetPasswordContent`).

## Sessions slide; a cookie cache spares the DB

Sessions last 30 days (`expiresIn`) and slide: any use more than a day after the last refresh (`updateAge`) pushes expiry out another 30 days. A daily user stays signed in indefinitely, and a session left idle for 30 days expires. A signed session-data cookie (cookie cache, 5 min) lets `auth()` resolve most requests without a DB read. The trade-off is that revocation (sign-out on another device, password reset) on other devices can lag by up to 5 minutes; the browser that resets its password has its cookies and local session cleared immediately. The `auth()` middleware forwards any refreshed `Set-Cookie` headers onto the handler's response, so the sliding expiry and the cookie cache both reach the browser.

## Runtime shape on Workers

- **A Better Auth instance per request** (`withAuth`), each with its own lazy `pg.Pool` limited to one connection. The Kysely adapter requires a Pool rather than a plain Client. Request-time schema validation is disabled because SQL migrations own the DDL. Workers can't reuse a socket across requests, and the bindings (Hyperdrive, secrets) only exist on the request env. The pool closes through `waitUntil` once the response and any deferred work have settled.
- **Auth emails are deferred** (`waitUntil`), so response latency can't reveal whether an address has an account.
- **Password hashing is native `node:crypto` scrypt.** `@better-auth/utils` has a `workerd` export condition that selects the Node implementation under `nodejs_compat`. Without it, Workers would get the pure-JS scrypt fallback, which is much slower against the Worker CPU budget.

## Security posture

- `trustedOrigins = [APP_URL]`. Better Auth rejects requests from any other `Origin` with `403 INVALID_ORIGIN`, and callback/redirect URLs must be on that origin too.
- Rate limits are stored in Postgres (`auth_rate_limits`), because isolate memory doesn't survive across requests, and are enabled only when `APP_ENV=production`. Better Auth's built-in rules cap sign-in and sign-up at 3 per 10 s and the email senders (`/send-verification-email`, `/request-password-reset`) at 3/min. The client IP comes from `cf-connecting-ip`.
- Google links into an existing account only if that account's email is already verified (Better Auth's explicit `requireLocalEmailVerified: true` setting). This blocks pre-registration takeover, where an attacker signs up with a victim's address and waits for the victim's Google sign-in to merge into the attacker-controlled account.
- Cookies are httpOnly and `SameSite=Lax`, and `Secure` (`__Secure-` prefixed) on https.

## Data model

Better Auth's core schema is mapped to snake_case tables through `modelName`/`fields` in `api/_lib/auth.ts`: `auth_users`, `auth_sessions`, `auth_accounts` (one row per sign-in method; `provider_id = 'credential'` holds the scrypt hash), `auth_verifications`, `auth_rate_limits`. The DDL in `0006_better_auth.sql` matches Better Auth’s `getMigrations` for that mapping, with an additional unique provider/account index. `0007_auth_account_uniqueness.sql` adds that index to databases that already applied `0006`, so the schema and mapping change together.

The app-side profile stays in `users` (tier, credits, BYOK, onboarding). It is re-keyed from `clerk_user_id` to **`auth_user_id`**, with an FK to `auth_users(id) on delete cascade`, and every per-user FK follows the rename. Deleting an `auth_users` row therefore cascades through all of that user's data. The row is still created lazily when an app-data handler or billing checkout first calls `getOrCreateUser`, and `getOrCreateUser` refreshes `users.email` from the session each time it runs, so no identity webhooks are needed. The Dodo checkout metadata key is renamed `clerk_user_id` → `user_id` (see [ADR 0005](./0005-commerce-checkout-and-webhook-idempotency.md)).

There was no user migration. Both the local and production databases were empty of Clerk-era users at cut-over, and payments weren't live, so no in-flight checkout carries the old metadata key.

## Consequences

- New worker secrets: `BETTER_AUTH_SECRET` (signs cookies; a prod-only value, and rotating it signs everyone out) and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. `CLERK_*`, `VITE_CLERK_PUBLISHABLE_KEY` and `.env.production` are gone, and the SPA needs no build-time keys.
- **Resend is now load-bearing.** Without `RESEND_API_KEY` + `RESEND_FROM` on a verified domain in production, nobody can verify an email, so password sign-up is dead. Locally, with no key, the worker logs `[auth] <subject> → <email>: <url>` instead of sending.
- We own the auth UI (`/auth`: sign-in, sign-up, forgot and reset password, Google), the account menu, and the email templates. There is no vendor dashboard and no vendor-hosted UI.
- **Hyperdrive query caching must stay off.** A cached read could serve a session after sign-out, or a stale list after a write. We use pooling only.
- Revocation on other devices lags by up to the 5-minute cookie-cache window.
- Workers' per-request model means one `pg.Pool` per guarded request, alongside the handler's own `pg.Client`.
