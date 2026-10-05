import { Hono } from 'hono'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { auth, authBaseURL, authHandler, createAuth, withAuth } from '../auth'
import type { AppEnv, Bindings } from '../env'

const { end, connect } = vi.hoisted(() => ({
  end: vi.fn(async () => undefined),
  connect: vi.fn(),
}))
vi.mock('pg', () => ({
  Pool: class {
    connect = connect
    end = end
  },
}))
vi.mock('better-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('better-auth')>()
  return { ...actual, betterAuth: vi.fn(actual.betterAuth) }
})

const env: Bindings = {
  APP_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'test-secret-long-enough-for-auth-tests-only',
  DATABASE_URL: 'postgres://unused/test',
}
const request = (path: string, body: unknown, cookie?: string) =>
  new Request(`${env.APP_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: env.APP_URL!,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
const config = () =>
  createAuth(env, { pool: new Pool(), defer: () => undefined })

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('auth configuration and email availability', () => {
  it.each([undefined, '', '   '])(
    'rejects a missing production APP_URL (%s)',
    (APP_URL) => {
      expect(() =>
        authBaseURL({ ...env, APP_ENV: 'production', APP_URL }),
      ).toThrow('APP_URL is not configured')
      expect(() =>
        createAuth(
          { ...env, APP_ENV: 'production', APP_URL },
          { pool: new Pool(), defer: () => undefined },
        ),
      ).toThrow('APP_URL is not configured')
    },
  )

  it('keeps the local URL fallback, disables introspection, and pins linking protection', async () => {
    expect(authBaseURL({ APP_URL: '  ' })).toBe('http://localhost:5173')
    const a = config()
    expect(a.options.advanced?.database?.validateSchema).toBe(false)
    expect(a.options.account?.accountLinking?.requireLocalEmailVerified).toBe(
      true,
    )
    await a.$context
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([
    'sign-up/email',
    'sign-in/email',
    'request-password-reset',
    'send-verification-email',
  ])('returns 503 before %s starts without production Resend', async (path) => {
    const app = new Hono<AppEnv>().post('/api/auth/*', authHandler)
    const response = await app.request(
      request(path, {
        email: 'a@example.com',
        name: 'A',
        password: 'password123',
      }),
      {},
      { ...env, APP_ENV: 'production', RESEND_API_KEY: ' ' },
    )
    expect(response.status).toBe(503)
    expect(vi.mocked(betterAuth)).not.toHaveBeenCalled()
  })

  it('logs local verification links and defers sends with a configured key', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const a = config()
    const user = {
      id: 'a',
      email: 'a@example.com',
      name: 'A',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await a.options.emailVerification!.sendVerificationEmail!({
      user,
      url: 'http://localhost:5173/verify',
      token: 't',
    })
    expect(info).toHaveBeenCalledWith(expect.stringContaining('/verify'))
    const send = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'))
    const deferred: Promise<unknown>[] = []
    const prod = createAuth(
      { ...env, APP_ENV: 'production', RESEND_API_KEY: 'test-key' },
      { pool: new Pool(), defer: (task) => deferred.push(task) },
    )
    await prod.options.emailVerification!.sendVerificationEmail!({
      user,
      url: 'https://vibe.test/verify',
      token: 't',
    })
    expect(deferred).toHaveLength(1)
    await Promise.all(deferred)
    expect(send).toHaveBeenCalledOnce()
  })
})

describe('session guard', () => {
  it.each([false, true])(
    'forwards Set-Cookie when a session exists: %s',
    async (signedIn) => {
      const a = config()
      const headers = new Headers()
      headers.append(
        'set-cookie',
        'better-auth.session_token=; Max-Age=0; Path=/',
      )
      headers.append(
        'set-cookie',
        'better-auth.session_data=; Max-Age=0; Path=/',
      )
      Object.defineProperty(a.api, 'getSession', {
        value: vi.fn(async () => ({
          headers,
          response: signedIn
            ? {
                user: { id: 'a', email: 'a@example.com' },
                session: { id: 'session' },
              }
            : null,
        })),
      })
      vi.mocked(betterAuth<typeof a.options>).mockReturnValueOnce(a)
      const app = new Hono<AppEnv>()
      app.use('/private', auth())
      app.get('/private', (c) =>
        c.json({ userId: c.get('userId'), email: c.get('email') }),
      )
      const response = await app.request('/private', {}, env)
      expect(response.status).toBe(signedIn ? 200 : 401)
      expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie())
      if (signedIn)
        expect(await response.json()).toEqual({
          userId: 'a',
          email: 'a@example.com',
        })
    },
  )

  it('catches pool disconnect failures after deferred work settles', async () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    end.mockRejectedValueOnce(new Error('disconnect failed'))
    const pending: Promise<unknown>[] = []
    const app = new Hono<AppEnv>().get('/test', async (c) => {
      await withAuth(c, async () => undefined)
      return c.text('ok')
    })
    const response = await app.request('/test', {}, env, {
      waitUntil: (task) => {
        pending.push(task)
      },
      passThroughOnException() {},
      props: {},
    })
    expect(response.status).toBe(200)
    await Promise.all(pending)
    expect(errors).toHaveBeenCalledWith(
      'auth pool end failed',
      expect.any(Error),
    )
  })
})

describe('password reset with a cached session', () => {
  it('revokes database sessions and expires this browser’s cookies on success only', async () => {
    const options = config().options
    const a = betterAuth({
      ...options,
      database: memoryAdapter({
        auth_users: [],
        auth_sessions: [],
        auth_accounts: [],
        auth_verifications: [],
        auth_rate_limits: [],
      }),
      emailAndPassword: {
        ...options.emailAndPassword!,
        requireEmailVerification: false,
      },
      emailVerification: { sendOnSignUp: false },
    })
    const signup = await a.handler(
      request('sign-up/email', {
        name: 'A',
        email: 'a@example.com',
        password: 'old-password',
      }),
    )
    expect(signup.status).toBe(200)
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const { user } = (await signup.json()) as { user: { id: string } }
    const context = await a.$context
    await context.internalAdapter.createVerificationValue({
      identifier: 'reset-password:reset-token',
      value: user.id,
      expiresAt: new Date(Date.now() + 60000),
    })
    const invalid = await a.handler(
      request(
        'reset-password',
        { token: 'bad', newPassword: 'new-password' },
        cookie,
      ),
    )
    expect(invalid.status).toBe(400)
    expect(
      invalid.headers
        .getSetCookie()
        .some((value) => value.includes('Max-Age=0')),
    ).toBe(false)
    const response = await a.handler(
      request(
        'reset-password',
        { token: 'reset-token', newPassword: 'new-password' },
        cookie,
      ),
    )
    expect(response.status).toBe(200)
    const cleared = response.headers.getSetCookie()
    expect(cleared).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/session_token=;.*Max-Age=0/),
        expect.stringMatching(/session_data=;.*Max-Age=0/),
      ]),
    )
    const session = await a.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    })
    expect(session).toBeNull()
  })
})
