import { createClerkClient } from '@clerk/backend'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'

import type { AppEnv } from './env'

export function auth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secretKey = c.env.CLERK_SECRET_KEY

    if (!secretKey) {
      throw new HTTPException(500, { message: 'CLERK_SECRET_KEY is not configured' })
    }

    const clerk = createClerkClient({ secretKey })
    const authorization = c.req.header('authorization')
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
    const sessionToken = bearerToken ?? getCookie(c, '__session')

    if (!sessionToken) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    const requestState = await clerk.authenticateRequest(c.req.raw, { secretKey })

    if (!requestState.isSignedIn) {
      throw new HTTPException(401, { message: 'Invalid session' })
    }

    const userId = requestState.toAuth().userId

    if (!userId) {
      throw new HTTPException(401, { message: 'Missing user id' })
    }

    const user = await clerk.users.getUser(userId)
    const email = user.primaryEmailAddress?.emailAddress ?? null
    const databaseUrl = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL

    if (!databaseUrl) {
      throw new HTTPException(500, { message: 'Database connection string is not configured' })
    }

    c.set('userId', userId)
    c.set('email', email)
    c.set('databaseUrl', databaseUrl)

    await next()
  }
}
