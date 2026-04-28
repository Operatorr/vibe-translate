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
  textToSpeechSchema,
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
app.use('/api/ai/dictation', auth())
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

function getProviderErrorMessage(status: number, body: string) {
  if (!body.trim()) return `Text-to-speech provider request failed (${status})`

  try {
    const payload = JSON.parse(body) as {
      detail?:
        | string
        | Array<{ msg?: string; message?: string; type?: string }>
        | { message?: string; status?: string; code?: string; request_id?: string }
      message?: string
    }
    const detail = payload.detail
    const message =
      payload.message ??
      (typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? (detail[0]?.msg ?? detail[0]?.message ?? detail[0]?.type)
          : (detail?.message ?? detail?.status ?? detail?.code))
    const requestId = !Array.isArray(detail) && typeof detail === 'object' ? detail?.request_id : undefined

    if (message) {
      return [
        `Text-to-speech provider request failed (${status})`,
        message,
        requestId ? `request_id: ${requestId}` : null,
      ]
        .filter(Boolean)
        .join(': ')
    }
  } catch {
    // Fall through to a short text fallback below.
  }

  return `Text-to-speech provider request failed (${status}): ${body.slice(0, 240)}`
}

const toElevenLabsLanguageCode = (languageCode?: string) =>
  languageCode?.split('-')[0]

app.post('/api/ai/text-to-speech', zValidator('json', textToSpeechSchema), async (c) => {
  const { text, vibe, languageCode } = c.req.valid('json')
  const apiKey = c.env.ELEVENLABS_API_KEY?.trim()
  const voiceIds = {
    yakuza: c.env.ELEVENLABS_VOICE_YAKUZA,
    friend: c.env.ELEVENLABS_VOICE_FRIEND,
    casual: c.env.ELEVENLABS_VOICE_CASUAL,
    keigo: c.env.ELEVENLABS_VOICE_KEIGO,
    keigoplus: c.env.ELEVENLABS_VOICE_KEIGOPLUS,
    emperor: c.env.ELEVENLABS_VOICE_EMPEROR,
  } satisfies Record<typeof vibe, string | undefined>
  const voiceId = voiceIds[vibe]?.trim()
  const modelId = c.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'

  if (!apiKey) {
    throw new HTTPException(503, { message: 'Text-to-speech is not configured' })
  }

  if (!voiceId) {
    throw new HTTPException(503, {
      message: 'Text-to-speech voice is not configured for this vibe',
    })
  }

  let response: Response
  const elevenLabsLanguageCode = toElevenLabsLanguageCode(languageCode)
  const supportsLanguageTextNormalization = elevenLabsLanguageCode === 'ja'

  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId,
      )}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          apply_text_normalization: 'auto',
          ...(elevenLabsLanguageCode
            ? { language_code: elevenLabsLanguageCode }
            : {}),
          ...(supportsLanguageTextNormalization
            ? { apply_language_text_normalization: true }
            : {}),
        }),
      },
    )
  } catch {
    throw new HTTPException(502, {
      message: 'Text-to-speech provider is unreachable',
    })
  }

  if (!response.ok) {
    const providerErrorBody = await response.text().catch(() => '')

    throw new HTTPException(502, {
      message: getProviderErrorMessage(response.status, providerErrorBody),
    })
  }

  if (!response.body) {
    throw new HTTPException(502, {
      message: 'Text-to-speech provider returned an empty response',
    })
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'audio/mpeg',
    },
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
