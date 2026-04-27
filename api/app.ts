import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'

import { auth } from './_lib/auth'
import { createDbClient } from './_lib/db'
import type { AppEnv } from './_lib/env'
import { formatError } from './_lib/errors'
import {
  checkoutSchema,
  chatCreateSchema,
  chatUpdateSchema,
  translationCreateSchema,
  translationUpdateSchema,
  userUpdateSchema,
  waitlistSchema,
} from './_lib/schemas'
import { tierLimits } from './_lib/tier'

const app = new Hono<AppEnv>()

app.use(
  '*',
  cors({
    origin: (_origin, c) => c.env.APP_URL ?? 'http://localhost:5173',
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
)

app.onError((error, c) => {
  const formatted = formatError(error)
  return c.json({ error: formatted }, formatted.status)
})

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    env: c.env.APP_ENV ?? 'development',
  }),
)

app.get('/api/diagnostics', async (c) => {
  const db = createDbClient(c.env)

  try {
    await db.connect()
    const result = await db.query('select now() as now')
    return c.json({
      ok: true,
      database: 'connected',
      now: result.rows[0]?.now,
    })
  } catch (error) {
    return c.json(
      {
        ok: false,
        database: 'unavailable',
        message: error instanceof Error ? error.message : 'Unknown database error',
      },
      503,
    )
  } finally {
    await db.end().catch(() => undefined)
  }
})

app.post('/api/waitlist', zValidator('json', waitlistSchema), async (c) => {
  const payload = c.req.valid('json')
  return c.json({ ok: true, email: payload.email }, 201)
})

app.use('/api/users/*', auth())
app.use('/api/chats/*', auth())
app.use('/api/translations/*', auth())
app.use('/api/activity/*', auth())
app.use('/api/ai/*', auth())
app.use('/api/billing/*', auth())
app.use('/api/export', auth())

app.get('/api/users/me', (c) => {
  const userId = c.get('userId')
  const email = c.get('email')

  return c.json({
    id: userId,
    email,
    tier: 'free',
    limits: tierLimits.free,
    onboardingComplete: false,
  })
})

app.patch('/api/users/me', zValidator('json', userUpdateSchema), (c) => {
  return c.json({
    ok: true,
    user: {
      id: c.get('userId'),
      ...c.req.valid('json'),
    },
  })
})

app.get('/api/chats', (c) => {
  return c.json([])
})

app.get('/api/chats/:chatId', (c) => {
  return c.json({
    id: c.req.param('chatId'),
    title: 'Example chat',
    sourceLanguage: 'English',
    targetLanguage: 'Thai',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

app.post('/api/chats', zValidator('json', chatCreateSchema), (c) => {
  const payload = c.req.valid('json')
  return c.json(
    {
      id: crypto.randomUUID(),
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/api/chats/:chatId', zValidator('json', chatUpdateSchema), (c) => {
  return c.json({
    id: c.req.param('chatId'),
    ...c.req.valid('json'),
    updatedAt: new Date().toISOString(),
  })
})

app.delete('/api/chats/:chatId', (c) => {
  return c.json({ ok: true, id: c.req.param('chatId') })
})

app.post('/api/chats/reorder', (c) => {
  return c.json({ ok: true, userId: c.get('userId') })
})

app.get('/api/translations', (c) => {
  return c.json([])
})

app.post('/api/translations', zValidator('json', translationCreateSchema), (c) => {
  return c.json(
    {
      id: crypto.randomUUID(),
      ...c.req.valid('json'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/api/translations/:translationId', zValidator('json', translationUpdateSchema), (c) => {
  return c.json({
    id: c.req.param('translationId'),
    ...c.req.valid('json'),
    updatedAt: new Date().toISOString(),
  })
})

app.delete('/api/translations/:translationId', (c) => {
  return c.json({ ok: true, id: c.req.param('translationId') })
})

app.get('/api/activity', (c) => {
  return c.json([])
})

app.post('/api/ai/dictation', async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!body) {
    throw new HTTPException(400, { message: 'JSON body is required' })
  }

  return c.json({
    sourceLanguage: 'auto',
    targetLanguage: 'English',
    tone: 'natural',
    instructions: String(body.prompt ?? ''),
  })
})

app.post('/api/billing/checkout', zValidator('json', checkoutSchema), (c) => {
  return c.json({
    checkoutUrl: 'https://checkout.example.test',
    plan: c.req.valid('json').plan,
  })
})

app.post('/api/billing/cancel', (c) => {
  return c.json({ ok: true, userId: c.get('userId') })
})

app.post('/api/billing/switch-plan', zValidator('json', checkoutSchema), (c) => {
  return c.json({ ok: true, plan: c.req.valid('json').plan })
})

app.post('/api/billing/webhooks/dodo', async (c) => {
  return c.json({ ok: true, received: await c.req.text() })
})

app.get('/api/export', (c) => {
  return c.json({
    userId: c.get('userId'),
    chats: [],
    translations: [],
    activity: [],
  })
})

export default app
