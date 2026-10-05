import { betterAuth } from 'better-auth'
import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Pool } from 'pg'

import { databaseUrl } from './db'
import {
  resetPasswordContent,
  sendTransactionalEmail,
  verifyEmailContent,
} from './email'
import type { AppEnv, Bindings } from './env'

// Self-hosted auth (Better Auth): email + password with required email
// verification, plus Google. Identity lives in the auth_* tables; the app's
// `users` row is keyed by auth_users.id and created lazily (users.ts).
// See docs/SECURITY.md#authentication and docs/adr/0008.

const DAY = 60 * 60 * 24

type AuthDeps = {
  pool: Pool
  // Deferred work (auth emails, Better Auth background tasks) — runs after the
  // response via waitUntil, so email latency can't leak account existence.
  defer: (task: Promise<unknown>) => void
}

export function createAuth(env: Bindings, { pool, defer }: AuthDeps) {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret) {
    throw new HTTPException(500, {
      message: 'BETTER_AUTH_SECRET is not configured',
    })
  }
  const baseURL = env.APP_URL ?? 'http://localhost:5173'
  const isProduction = env.APP_ENV === 'production'

  const sendAuthEmail = (
    to: string,
    content: { subject: string; html: string; text: string },
    url: string,
  ) => {
    // Local dev usually has no Resend key: surface the link in the worker log.
    if (!isProduction && !env.RESEND_API_KEY?.trim()) {
      console.info(`[auth] ${content.subject} → ${to}: ${url}`)
      return
    }
    defer(
      sendTransactionalEmail({ env, to, ...content }).catch((error) =>
        console.error('auth email failed', error),
      ),
    )
  }

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim()
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim()

  return betterAuth({
    appName: 'Vibe Translate',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [baseURL],
    database: pool,

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAuthEmail(user.email, resetPasswordContent(url), url),
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified sign-in attempt re-sends the link instead of dead-ending.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthEmail(user.email, verifyEmailContent(url), url),
    },
    socialProviders:
      googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              prompt: 'select_account',
            },
          }
        : {},

    // Sliding sessions: any visit after `updateAge` pushes expiry out another
    // `expiresIn`, so daily users stay signed in indefinitely; a session idle
    // for 30 days expires. The signed cookie cache spares a DB read per API
    // call (revocation lags by up to `maxAge`).
    session: {
      modelName: 'auth_sessions',
      expiresIn: 30 * DAY,
      updateAge: DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      fields: {
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    user: {
      modelName: 'auth_users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    // Isolate memory doesn't survive across Workers requests, so counters live
    // in Postgres. Better Auth's built-in rules already cap sign-in/up at 3 per
    // 10 s and the email senders (verification, password reset) at 3 per minute.
    rateLimit: {
      enabled: isProduction,
      storage: 'database',
      modelName: 'auth_rate_limits',
      fields: { lastRequest: 'last_request' },
    },

    onAPIError: { errorURL: `${baseURL}/auth` },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      backgroundTasks: { handler: defer },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>

function waitUntil(c: Context<AppEnv>, task: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(task)
  } catch {
    // No ExecutionContext (unit tests): let the task settle on its own.
    void task
  }
}

// Better Auth is built per request: a pg socket can't be reused across Workers
// requests, and the Hyperdrive/secret bindings only exist on the request env.
// The pool closes once the response and any deferred work have settled.
export async function withAuth<T>(
  c: Context<AppEnv>,
  fn: (auth: Auth) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl(c.env) })
  const deferred: Promise<unknown>[] = []
  try {
    return await fn(
      createAuth(c.env, { pool, defer: (task) => deferred.push(task) }),
    )
  } finally {
    waitUntil(
      c,
      Promise.allSettled(deferred).then(() => pool.end()),
    )
  }
}

// Route guard: resolves the Better Auth session (cookie cache first, then DB)
// and exposes the user to handlers. Any refreshed session cookies — the sliding
// expiry and the cookie cache — are forwarded on the handler's response.
export function auth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { headers, response: session } = await withAuth(c, (a) =>
      a.api.getSession({ headers: c.req.raw.headers, returnHeaders: true }),
    )

    if (!session) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    c.set('userId', session.user.id)
    c.set('email', session.user.email)

    await next()

    const cookies = headers.getSetCookie()
    if (cookies.length > 0) {
      // Re-wrap: responses passed through from fetch() have immutable headers.
      c.res = new Response(c.res.body, c.res)
      for (const cookie of cookies) c.res.headers.append('set-cookie', cookie)
    }
  }
}
