import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'

import { auth } from './_lib/auth'
import { createDbClient } from './_lib/db'
import type { AppEnv } from './_lib/env'
import { formatError } from './_lib/errors'
import {
  byokModelsSchema,
  byokSetSchema,
  characterCreateSchema,
  characterReorderSchema,
  characterUpdateSchema,
  checkoutSchema,
  memorySearchSchema,
  onboardingDictateSchema,
  segmentCreateSchema,
  segmentUpdateSchema,
  textToSpeechSchema,
  threadCreateSchema,
  threadUpdateSchema,
  userUpdateSchema,
  waitlistSchema,
} from './_lib/schemas'
import { EXPLAIN_PAYLOAD_VERSION } from './_lib/explain'
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
app.use('/api/characters/*', auth())
app.use('/api/threads/*', auth())
app.use('/api/segments/*', auth())
app.use('/api/memory', auth())
app.use('/api/activity/*', auth())
app.use('/api/onboarding/*', auth())
app.use('/api/ai/dictation', auth())
app.use('/api/ai/text-to-speech', auth())
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
    credits: { balance: 0, refilledAt: null },
    byok: { configured: false, last4: null, translateModelId: null, explainModelId: null },
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

// Set or replace the user's BYOK OpenRouter key. Plaintext over TLS only;
// stored as AES-GCM ciphertext via api/_lib/secrets.ts. Response includes
// `last4` only; the full key is never returned to the client.
app.put('/api/users/me/byok', zValidator('json', byokSetSchema), (c) => {
  const payload = c.req.valid('json')
  return c.json({
    ok: true,
    configured: true,
    last4: payload.apiKey.slice(-4),
  })
})

app.delete('/api/users/me/byok', (c) => {
  return c.json({ ok: true, configured: false, userId: c.get('userId') })
})

// Optional per-task BYOK model override. `null` clears.
app.patch('/api/users/me/byok/models', zValidator('json', byokModelsSchema), (c) => {
  return c.json({ ok: true, ...c.req.valid('json') })
})

// ---- Characters ----------------------------------------------------------

app.get('/api/characters', (c) => {
  return c.json([])
})

app.get('/api/characters/:characterId', (c) => {
  return c.json({
    id: c.req.param('characterId'),
    name: 'Oba-chan',
    initials: 'お',
    color: 'magenta-400',
    sourceLanguage: 'en-US',
    targetLanguage: 'ja-JP',
    defaultVibe: 'casual',
    temperature: 0.4,
    persona: {
      age: '60s',
      region: 'Osaka',
      formality: 'warm but blunt',
      traits: ['warm', 'direct', 'uses 〜やん', 'dialect: kansai-ben'],
    },
    instructions: 'Your maternal grandmother in Osaka. Warm but blunt. Uses Kansai-ben.',
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

app.post('/api/characters', zValidator('json', characterCreateSchema), (c) => {
  const payload = c.req.valid('json')
  return c.json(
    {
      id: crypto.randomUUID(),
      ...payload,
      sortOrder: 0,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/api/characters/:characterId', zValidator('json', characterUpdateSchema), (c) => {
  return c.json({
    id: c.req.param('characterId'),
    ...c.req.valid('json'),
    updatedAt: new Date().toISOString(),
  })
})

app.delete('/api/characters/:characterId', (c) => {
  return c.json({ ok: true, id: c.req.param('characterId') })
})

app.post('/api/characters/reorder', zValidator('json', characterReorderSchema), (c) => {
  return c.json({ ok: true, userId: c.get('userId'), characterIds: c.req.valid('json').characterIds })
})

// ---- Threads -------------------------------------------------------------

app.get('/api/threads', (c) => {
  // Optional ?characterId= filter; resolved server-side once DB wiring lands.
  return c.json([])
})

app.get('/api/threads/:threadId', (c) => {
  return c.json({
    id: c.req.param('threadId'),
    characterId: crypto.randomUUID(),
    title: 'Asking for grandma\'s recipe',
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

app.post('/api/threads', zValidator('json', threadCreateSchema), (c) => {
  const payload = c.req.valid('json')
  return c.json(
    {
      id: crypto.randomUUID(),
      ...payload,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/api/threads/:threadId', zValidator('json', threadUpdateSchema), (c) => {
  return c.json({
    id: c.req.param('threadId'),
    ...c.req.valid('json'),
    updatedAt: new Date().toISOString(),
  })
})

app.delete('/api/threads/:threadId', (c) => {
  return c.json({ ok: true, id: c.req.param('threadId') })
})

// ---- Segments ------------------------------------------------------------

app.get('/api/segments', (c) => {
  return c.json([])
})

// Sync translate-and-return. Client supplies `{ threadId, sourceText, vibe? }`;
// the worker resolves the Character (default_vibe, temperature, persona,
// source/target language), calls the translation provider, and writes the
// Segment with server-produced `targetText` and `tokenAlignment`.
app.post('/api/segments', zValidator('json', segmentCreateSchema), (c) => {
  const payload = c.req.valid('json')
  return c.json(
    {
      id: crypto.randomUUID(),
      threadId: payload.threadId,
      sourceText: payload.sourceText,
      // Server-produced — placeholder until translateSegment() is wired to OpenRouter.
      targetText: '',
      vibe: payload.vibe ?? null,
      tokenAlignment: [],
      tokenUsage: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    201,
  )
})

app.patch('/api/segments/:segmentId', zValidator('json', segmentUpdateSchema), (c) => {
  return c.json({
    id: c.req.param('segmentId'),
    ...c.req.valid('json'),
    updatedAt: new Date().toISOString(),
  })
})

app.delete('/api/segments/:segmentId', (c) => {
  return c.json({ ok: true, id: c.req.param('segmentId') })
})

// Generate-on-miss, cache-in-DB Explain. Lookup order:
//   1) explains where (segment_id, version = EXPLAIN_PAYLOAD_VERSION)
//   2) explains where (user_id, target_language, target_text_hash, version)
//      — cross-segment reuse for repeated target text
//   3) generate via api/_lib/explain.ts, insert, return
app.get('/api/segments/:segmentId/explain', (c) => {
  return c.json({
    segmentId: c.req.param('segmentId'),
    version: EXPLAIN_PAYLOAD_VERSION,
    body: null,
    cached: false,
  })
})

// Translation Memory search. Embeds `q`, runs cosine similarity against the
// user's segments.source_embedding (optionally scoped to a character or
// target language), returns top-K with similarity scores.
app.get('/api/memory', zValidator('query', memorySearchSchema), (c) => {
  const params = c.req.valid('query')
  return c.json({
    query: params.q,
    characterId: params.characterId ?? null,
    targetLanguage: params.targetLanguage ?? null,
    hits: [] as Array<{ segmentId: string; similarity: number }>,
  })
})

app.get('/api/activity', (c) => {
  return c.json([])
})

// Free, one-shot onboarding dictation. Parses a free-form description into a
// Character draft for the confirmation form. `ok: false` → client falls back to
// the empty form. Does not charge credits; should be rate-limited per user and
// only served while onboarding_complete = false.
app.post('/api/onboarding/dictate', zValidator('json', onboardingDictateSchema), (c) => {
  return c.json({
    ok: true,
    name: null,
    sourceLanguage: null,
    targetLanguage: null,
    defaultVibe: null,
    temperature: null,
    persona: null,
    instructions: null,
    prompt: c.req.valid('json').prompt,
  })
})

// In-app dictation (Pro+, credit-charged). Same parse, used to spin up
// additional Characters by voice after onboarding.
app.post('/api/ai/dictation', zValidator('json', onboardingDictateSchema), (c) => {
  return c.json({
    ok: true,
    name: null,
    sourceLanguage: null,
    targetLanguage: null,
    defaultVibe: null,
    temperature: null,
    persona: null,
    instructions: null,
    prompt: c.req.valid('json').prompt,
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
    characters: [],
    threads: [],
    segments: [],
    activity: [],
  })
})

export default app
