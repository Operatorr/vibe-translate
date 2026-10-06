import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { deleteSessionCookie } from 'better-auth/cookies'
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
  const isProduction = env.APP_ENV === 'production'
  const baseURL = authBaseURL(env)

  const sendAuthEmail = (
    to: string,
    content: { subject: string; html: string; text: string },
    url: string,
  ) => {
    // Local dev usually has no Resend key: surface the link in the worker log.
    if (!env.RESEND_API_KEY?.trim()) {
      if (!isProduction) {
        console.info(`[auth] ${content.subject} → ${to}: ${url}`)
        return
      }
      throw new HTTPException(503, { message: 'Auth email is not configured' })
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
      accountLinking: { requireLocalEmailVerified: true },
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
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === '/reset-password' &&
          typeof ctx.context.returned === 'object' &&
          ctx.context.returned !== null &&
          'status' in ctx.context.returned &&
          ctx.context.returned.status === true
        ) {
          deleteSessionCookie(ctx)
        }
      }),
    },
    advanced: {
      // SQL migrations own the schema. Per-request validation defeats cookie
      // caching and starts catalog queries outside backgroundTasks.
      database: { validateSchema: false },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      backgroundTasks: { handler: defer },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>

export function authBaseURL(env: Bindings): string {
  const url = env.APP_URL?.trim()
  if (!url && env.APP_ENV === 'production') {
    throw new HTTPException(500, { message: 'APP_URL is not configured' })
  }
  return url || 'http://localhost:5173'
}

// Check before Better Auth starts a signup or hides reset errors to prevent
// enumeration. Missing infrastructure is independent of account existence.
export function authHandler(c: Context<AppEnv>): Promise<Response> {
  const emailPaths = new Set([
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/email',
    '/api/auth/request-password-reset',
    '/api/auth/send-verification-email',
  ])
  if (
    c.env.APP_ENV === 'production' &&
    !c.env.RESEND_API_KEY?.trim() &&
    c.req.method === 'POST' &&
    emailPaths.has(c.req.path.replace(/\/$/, ''))
  ) {
    throw new HTTPException(503, { message: 'Auth email is not configured' })
  }
  return withAuth(c, (a) => a.handler(c.req.raw))
}

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
  // Kysely requires Pool.connect() -> releasable PoolClient, not pg.Client.
  // One lazy connection is enough; cookie-cache hits never connect.
  const pool = new Pool({ connectionString: databaseUrl(c.env), max: 1 })
  const deferred: Promise<unknown>[] = []
  try {
    return await fn(
      createAuth(c.env, { pool, defer: (task) => deferred.push(task) }),
    )
  } finally {
    waitUntil(
      c,
      Promise.allSettled(deferred)
        .then(() => pool.end())
        .catch((error) => {
          console.error('auth pool end failed', error)
        }),
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
      const response = c.json(
        { error: { message: 'Authentication required', status: 401 } },
        401,
      )
      for (const cookie of headers.getSetCookie())
        response.headers.append('set-cookie', cookie)
      return response
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
