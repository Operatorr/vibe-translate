import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'

import { draftCharacterFromDictation, translateSegment } from './_lib/ai'
import { logActivity } from './_lib/activity'
import { auth } from './_lib/auth'
import {
  computeCredits,
  estimateCredits,
  reconcileSpend,
  refundReservation,
  reserveCredits,
  type Reservation,
} from './_lib/credits'
import { createDbClient, withDb } from './_lib/db'
import { embedText, formatVector, parseVector, sha256Hex } from './_lib/embeddings'
import { sendTransactionalEmail, subscriptionConfirmationEmail } from './_lib/email'
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
import { EXPLAIN_PAYLOAD_VERSION, generateExplain } from './_lib/explain'
import { resolveCallTarget } from './_lib/openrouter'
import { assertUserOwnsResource, canUseFeature } from './_lib/permissions'
import { encryptSecret, lastFour } from './_lib/secrets'
import type { Persona, SegmentToken, VibeStop } from './_lib/schemas'
import { fingerprint, isCanonical, lookupCache, upsertCache } from './_lib/translation-cache'
import { getOrCreateUser, toMeResponse } from './_lib/users'
import {
  cancelSubscription,
  createCheckoutSession,
  processDodoWebhook,
  switchPlan,
  verifyDodoSignature,
  type DodoEvent,
} from './_lib/payments'
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
// Billing routes are authenticated EXCEPT the Dodo webhook, which is
// unauthenticated by design (Dodo cannot present a Clerk session) and instead
// verifies a Standard Webhooks signature. See SECURITY.md#webhook-signatures.
app.use('/api/billing/checkout', auth())
app.use('/api/billing/cancel', auth())
app.use('/api/billing/switch-plan', auth())
app.use('/api/export', auth())

app.get('/api/users/me', (c) =>
  withDb(c.env, async (db) => {
    const user = await getOrCreateUser(db, c.get('userId'), c.get('email'))
    return c.json(toMeResponse(user))
  }),
)

app.patch('/api/users/me', zValidator('json', userUpdateSchema), (c) => {
  const updates = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const fields: Array<[string, unknown]> = []
    if (updates.displayName !== undefined) fields.push(['display_name', updates.displayName])
    if (updates.onboardingComplete !== undefined)
      fields.push(['onboarding_complete', updates.onboardingComplete])
    if (updates.locale !== undefined) fields.push(['locale', updates.locale])
    if (fields.length > 0) {
      const setClause = fields.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      await db.query(
        `update users set ${setClause}, updated_at = now() where clerk_user_id = $1`,
        [userId, ...fields.map(([, value]) => value)],
      )
    }
    const user = await getOrCreateUser(db, userId, c.get('email'))
    return c.json({ ok: true, user: toMeResponse(user) })
  })
})

// Set or replace the user's BYOK OpenRouter key. Plaintext over TLS only;
// stored as AES-GCM ciphertext via api/_lib/secrets.ts. Response includes
// `last4` only; the full key is never returned to the client.
app.put('/api/users/me/byok', zValidator('json', byokSetSchema), (c) => {
  const { apiKey } = c.req.valid('json')
  const userId = c.get('userId')
  const encryptionKey = c.env.CREDENTIALS_ENCRYPTION_KEY?.trim()
  if (!encryptionKey) throw new HTTPException(503, { message: 'BYOK storage is not configured' })
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const cipher = await encryptSecret(apiKey, encryptionKey)
    const last4 = lastFour(apiKey)
    await db.query(
      `update users
          set openrouter_api_key_cipher = $2, openrouter_api_key_last4 = $3, updated_at = now()
        where clerk_user_id = $1`,
      [userId, cipher, last4],
    )
    return c.json({ ok: true, configured: true, last4 })
  })
})

app.delete('/api/users/me/byok', (c) => {
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    await db.query(
      `update users
          set openrouter_api_key_cipher = null, openrouter_api_key_last4 = null,
              byok_translate_model_id = null, byok_explain_model_id = null, updated_at = now()
        where clerk_user_id = $1`,
      [userId],
    )
    return c.json({ ok: true, configured: false })
  })
})

// Optional per-task BYOK model override. `null` clears.
app.patch('/api/users/me/byok/models', zValidator('json', byokModelsSchema), (c) => {
  const updates = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const fields: Array<[string, unknown]> = []
    if (updates.translateModelId !== undefined)
      fields.push(['byok_translate_model_id', updates.translateModelId])
    if (updates.explainModelId !== undefined)
      fields.push(['byok_explain_model_id', updates.explainModelId])
    if (fields.length > 0) {
      const setClause = fields.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      await db.query(
        `update users set ${setClause}, updated_at = now() where clerk_user_id = $1`,
        [userId, ...fields.map(([, value]) => value)],
      )
    }
    return c.json({
      ok: true,
      translateModelId: updates.translateModelId ?? null,
      explainModelId: updates.explainModelId ?? null,
    })
  })
})

// ---- DB row mappers (snake_case → API camelCase) -------------------------

const CHARACTER_COLUMNS = `id, user_id, name, initials, color, source_language, target_language,
  default_vibe, temperature, persona, instructions, sort_order, archived_at, created_at, updated_at`

type CharacterDbRow = {
  id: string
  user_id: string
  name: string
  initials: string | null
  color: string | null
  source_language: string
  target_language: string
  default_vibe: VibeStop
  temperature: string | number
  persona: Persona
  instructions: string | null
  sort_order: number
  archived_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

function mapCharacter(r: CharacterDbRow) {
  return {
    id: r.id,
    name: r.name,
    initials: r.initials ?? undefined,
    color: r.color ?? undefined,
    sourceLanguage: r.source_language,
    targetLanguage: r.target_language,
    defaultVibe: r.default_vibe,
    temperature: Number(r.temperature),
    persona: r.persona,
    instructions: r.instructions ?? undefined,
    sortOrder: r.sort_order,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

const THREAD_COLUMNS = `id, character_id, user_id, title, archived_at, created_at, updated_at`

type ThreadDbRow = {
  id: string
  character_id: string
  user_id: string
  title: string
  archived_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

function mapThread(r: ThreadDbRow) {
  return {
    id: r.id,
    characterId: r.character_id,
    title: r.title,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

const SEGMENT_COLUMNS = `id, thread_id, source_text, target_text, vibe, token_alignment,
  token_usage, created_at, updated_at`

type SegmentDbRow = {
  id: string
  thread_id: string
  source_text: string
  target_text: string
  vibe: VibeStop | null
  token_alignment: SegmentToken[]
  token_usage: Record<string, unknown>
  created_at: string | Date
  updated_at: string | Date
}

function mapSegment(r: SegmentDbRow) {
  return {
    id: r.id,
    threadId: r.thread_id,
    sourceText: r.source_text,
    targetText: r.target_text,
    vibe: r.vibe,
    tokenAlignment: r.token_alignment,
    tokenUsage: r.token_usage,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

// ---- Characters ----------------------------------------------------------

app.get('/api/characters', (c) =>
  withDb(c.env, async (db) => {
    const userId = c.get('userId')
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query<CharacterDbRow>(
      `select ${CHARACTER_COLUMNS} from characters
        where user_id = $1 and archived_at is null
        order by sort_order asc, created_at asc`,
      [userId],
    )
    return c.json(res.rows.map(mapCharacter))
  }),
)

app.get('/api/characters/:characterId', (c) =>
  withDb(c.env, async (db) => {
    const userId = c.get('userId')
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query<CharacterDbRow>(
      `select ${CHARACTER_COLUMNS} from characters where id = $1`,
      [c.req.param('characterId')],
    )
    const row = res.rows[0]
    if (!row) throw new HTTPException(404, { message: 'Character not found' })
    assertUserOwnsResource(row.user_id, userId)
    return c.json(mapCharacter(row))
  }),
)

app.post('/api/characters', zValidator('json', characterCreateSchema), (c) => {
  const payload = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query<CharacterDbRow>(
      `insert into characters
         (user_id, name, initials, color, source_language, target_language,
          default_vibe, temperature, persona, instructions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning ${CHARACTER_COLUMNS}`,
      [
        userId,
        payload.name,
        payload.initials ?? null,
        payload.color ?? null,
        payload.sourceLanguage,
        payload.targetLanguage,
        payload.defaultVibe,
        payload.temperature,
        JSON.stringify(payload.persona),
        payload.instructions ?? null,
      ],
    )
    return c.json(mapCharacter(res.rows[0]), 201)
  })
})

app.patch('/api/characters/:characterId', zValidator('json', characterUpdateSchema), (c) => {
  const updates = c.req.valid('json')
  const userId = c.get('userId')
  const id = c.req.param('characterId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const owner = await db.query<{ user_id: string }>(
      `select user_id from characters where id = $1`,
      [id],
    )
    if (!owner.rows[0]) throw new HTTPException(404, { message: 'Character not found' })
    assertUserOwnsResource(owner.rows[0].user_id, userId)

    const columnByKey: Record<string, string> = {
      name: 'name',
      initials: 'initials',
      color: 'color',
      sourceLanguage: 'source_language',
      targetLanguage: 'target_language',
      defaultVibe: 'default_vibe',
      temperature: 'temperature',
      persona: 'persona',
      instructions: 'instructions',
    }
    const fields: Array<[string, unknown]> = []
    for (const [key, col] of Object.entries(columnByKey)) {
      const value = (updates as Record<string, unknown>)[key]
      if (value !== undefined) fields.push([col, key === 'persona' ? JSON.stringify(value) : value])
    }
    if (fields.length > 0) {
      const setClause = fields.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      await db.query(
        `update characters set ${setClause}, updated_at = now() where id = $1`,
        [id, ...fields.map(([, value]) => value)],
      )
    }
    const res = await db.query<CharacterDbRow>(
      `select ${CHARACTER_COLUMNS} from characters where id = $1`,
      [id],
    )
    return c.json(mapCharacter(res.rows[0]))
  })
})

app.delete('/api/characters/:characterId', (c) => {
  const userId = c.get('userId')
  const id = c.req.param('characterId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query(`delete from characters where id = $1 and user_id = $2`, [id, userId])
    if (res.rowCount === 0) throw new HTTPException(404, { message: 'Character not found' })
    return c.json({ ok: true, id })
  })
})

app.post('/api/characters/reorder', zValidator('json', characterReorderSchema), (c) => {
  const { characterIds } = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    await db.query('begin')
    try {
      for (let i = 0; i < characterIds.length; i += 1) {
        await db.query(
          `update characters set sort_order = $3, updated_at = now()
            where id = $1 and user_id = $2`,
          [characterIds[i], userId, i],
        )
      }
      await db.query('commit')
    } catch (error) {
      await db.query('rollback').catch(() => undefined)
      throw error
    }
    return c.json({ ok: true, characterIds })
  })
})

// ---- Threads -------------------------------------------------------------

app.get('/api/threads', (c) => {
  const userId = c.get('userId')
  const characterId = c.req.query('characterId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = characterId
      ? await db.query<ThreadDbRow>(
          `select ${THREAD_COLUMNS} from threads
            where user_id = $1 and character_id = $2 and archived_at is null
            order by updated_at desc`,
          [userId, characterId],
        )
      : await db.query<ThreadDbRow>(
          `select ${THREAD_COLUMNS} from threads
            where user_id = $1 and archived_at is null order by updated_at desc`,
          [userId],
        )
    return c.json(res.rows.map(mapThread))
  })
})

app.get('/api/threads/:threadId', (c) =>
  withDb(c.env, async (db) => {
    const userId = c.get('userId')
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query<ThreadDbRow>(
      `select ${THREAD_COLUMNS} from threads where id = $1`,
      [c.req.param('threadId')],
    )
    const row = res.rows[0]
    if (!row) throw new HTTPException(404, { message: 'Thread not found' })
    assertUserOwnsResource(row.user_id, userId)
    return c.json(mapThread(row))
  }),
)

app.post('/api/threads', zValidator('json', threadCreateSchema), (c) => {
  const payload = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    // The thread's Character must belong to the caller.
    const owner = await db.query<{ user_id: string }>(
      `select user_id from characters where id = $1`,
      [payload.characterId],
    )
    if (!owner.rows[0]) throw new HTTPException(404, { message: 'Character not found' })
    assertUserOwnsResource(owner.rows[0].user_id, userId)

    const res = await db.query<ThreadDbRow>(
      `insert into threads (character_id, user_id, title)
       values ($1,$2,$3) returning ${THREAD_COLUMNS}`,
      [payload.characterId, userId, payload.title],
    )
    return c.json(mapThread(res.rows[0]), 201)
  })
})

app.patch('/api/threads/:threadId', zValidator('json', threadUpdateSchema), (c) => {
  const updates = c.req.valid('json')
  const userId = c.get('userId')
  const id = c.req.param('threadId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const owner = await db.query<{ user_id: string }>(
      `select user_id from threads where id = $1`,
      [id],
    )
    if (!owner.rows[0]) throw new HTTPException(404, { message: 'Thread not found' })
    assertUserOwnsResource(owner.rows[0].user_id, userId)

    const fields: Array<[string, unknown]> = []
    if (updates.title !== undefined) fields.push(['title', updates.title])
    if (updates.archived !== undefined)
      fields.push(['archived_at', updates.archived ? new Date().toISOString() : null])
    if (fields.length > 0) {
      const setClause = fields.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      await db.query(`update threads set ${setClause}, updated_at = now() where id = $1`, [
        id,
        ...fields.map(([, value]) => value),
      ])
    }
    const res = await db.query<ThreadDbRow>(
      `select ${THREAD_COLUMNS} from threads where id = $1`,
      [id],
    )
    return c.json(mapThread(res.rows[0]))
  })
})

app.delete('/api/threads/:threadId', (c) => {
  const userId = c.get('userId')
  const id = c.req.param('threadId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query(`delete from threads where id = $1 and user_id = $2`, [id, userId])
    if (res.rowCount === 0) throw new HTTPException(404, { message: 'Thread not found' })
    return c.json({ ok: true, id })
  })
})

// ---- Segments ------------------------------------------------------------

app.get('/api/segments', (c) => {
  const userId = c.get('userId')
  const threadId = c.req.query('threadId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = threadId
      ? await db.query<SegmentDbRow>(
          `select ${SEGMENT_COLUMNS} from segments
            where user_id = $1 and thread_id = $2 order by created_at asc`,
          [userId, threadId],
        )
      : await db.query<SegmentDbRow>(
          `select ${SEGMENT_COLUMNS} from segments
            where user_id = $1 order by created_at desc limit 200`,
          [userId],
        )
    return c.json(res.rows.map(mapSegment))
  })
})

// Sync translate-and-return. Client supplies `{ threadId, sourceText, vibe? }`;
// the worker resolves the Character (default_vibe, temperature, persona,
// source/target language), de-dupes / checks the shared canonical cache, calls
// the translation provider, embeds the source, writes the Segment, and (on the
// platform key path) records the credit spend. See docs/BACKEND.md, adr/0004.
app.post('/api/segments', zValidator('json', segmentCreateSchema), (c) => {
  const payload = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))

    const charRes = await db.query<{
      user_id: string
      source_language: string
      target_language: string
      default_vibe: VibeStop
      temperature: string
      persona: Persona
      instructions: string | null
    }>(
      `select t.user_id, c.source_language, c.target_language, c.default_vibe,
              c.temperature, c.persona, c.instructions
         from threads t join characters c on c.id = t.character_id
        where t.id = $1`,
      [payload.threadId],
    )
    const character = charRes.rows[0]
    if (!character) throw new HTTPException(404, { message: 'Thread not found' })
    assertUserOwnsResource(character.user_id, userId)

    const temperature = Number(character.temperature)
    const resolvedVibe: VibeStop = payload.vibe ?? character.default_vibe
    const storedVibe = payload.vibe ?? null

    const insertSeg = (
      targetText: string,
      tokenAlignment: SegmentToken[],
      tokenUsage: Record<string, unknown>,
      embedding: number[] | null,
    ) =>
      db
        .query<SegmentDbRow>(
          `insert into segments
             (thread_id, user_id, source_text, target_text, vibe, token_alignment, token_usage, source_embedding)
           values ($1,$2,$3,$4,$5,$6,$7,$8::vector) returning ${SEGMENT_COLUMNS}`,
          [
            payload.threadId,
            userId,
            payload.sourceText,
            targetText,
            storedVibe,
            JSON.stringify(tokenAlignment),
            JSON.stringify(tokenUsage),
            embedding ? formatVector(embedding) : null,
          ],
        )
        .then((r) => r.rows[0])

    // Pre-check 1: identical in-thread request (null-aware vibe) → reuse, 0 credits.
    const dedup = await db.query<SegmentDbRow>(
      `select ${SEGMENT_COLUMNS} from segments
        where thread_id = $1 and source_text = $2 and vibe is not distinct from $3
        order by created_at desc limit 1`,
      [payload.threadId, payload.sourceText, storedVibe],
    )
    if (dedup.rows[0]) return c.json(mapSegment(dedup.rows[0]), 201)

    // Miss path → resolve the call target up front so the canonical fingerprint
    // is keyed by the model that will ACTUALLY run (BYOK model → env `*_MODEL`
    // override → registry default), not the registry default alone. Otherwise a
    // BYOK/override translation would be looked up and stored under a different
    // model's cache key. See adr/0004.
    const target = await resolveCallTarget(db, c.env, userId, 'translate')

    // Pre-check 2: shared canonical cache (no persona/instructions, default
    // temperature). Cache hits cost 0 credits, so this runs before any hold.
    const canonical = isCanonical({
      persona: character.persona,
      instructions: character.instructions ?? undefined,
      temperature,
    })
    let fp: string | null = null
    if (canonical) {
      fp = await fingerprint({
        sourceText: payload.sourceText,
        sourceLanguage: character.source_language,
        targetLanguage: character.target_language,
        vibe: resolvedVibe,
        modelId: target.modelId,
      })
      const hit = await lookupCache(db, fp)
      if (hit) {
        const row = await insertSeg(
          hit.targetText,
          hit.tokenAlignment,
          {},
          parseVector(hit.sourceEmbedding as unknown as string | number[] | null),
        )
        return c.json(mapSegment(row), 201)
      }
    }

    // Reserve an estimated credit hold before the paid model call on the
    // platform path. The atomic reservation gates concurrent requests (a user
    // near zero balance can't fan out many in-flight calls); it is reconciled to
    // the real cost on success, or refunded on failure. BYOK pays OpenRouter
    // directly and skips all credit accounting (adr/0003).
    let reservation: Reservation | null = null
    if (!target.isByok) {
      const estimate = estimateCredits(payload.sourceText, target.creditCostMultiplier)
      reservation = await reserveCredits(db, userId, estimate, 'spend.translate')
      if (!reservation) {
        throw new HTTPException(402, {
          message: 'Insufficient credits — add credits or configure BYOK',
        })
      }
    }

    try {
      const result = await translateSegment(
        {
          sourceText: payload.sourceText,
          sourceLanguage: character.source_language,
          targetLanguage: character.target_language,
          vibe: resolvedVibe,
          temperature,
          persona: character.persona,
          instructions: character.instructions ?? undefined,
        },
        { apiKey: target.apiKey, modelId: target.modelId, appUrl: c.env.APP_URL, reasoning: target.reasoning },
      )

      // Embeddings are always platform-owned (BYOK never applies; see adr/0003)
      // and best-effort: a failed embedding (provider down, or a BYOK-only deploy
      // with no platform key) must not discard an already-generated, paid-for
      // translation. Store source_embedding null — the Segment is simply excluded
      // from Translation memory search until a backfill (adr/0002, adr/0006).
      let embedding: number[] | null = null
      try {
        const embed = await embedText({
          text: payload.sourceText,
          apiKey: c.env.OPENROUTER_API_KEY ?? '',
        })
        embedding = embed.vector
      } catch {
        await logActivity(db, userId, 'segment.embed_failed', { threadId: payload.threadId })
      }
      const row = await insertSeg(result.targetText, result.tokenAlignment, result.tokenUsage, embedding)

      // Only platform-default translations seed the shared cross-user cache:
      // BYOK output comes from a user-chosen model and must not be served to
      // other users under the canonical fingerprint (adr/0004).
      if (canonical && fp && !target.isByok) {
        await upsertCache(db, fp, {
          sourceText: payload.sourceText,
          sourceLanguage: character.source_language,
          targetLanguage: character.target_language,
          vibe: resolvedVibe,
          modelId: result.tokenUsage.modelId,
          targetText: result.targetText,
          tokenAlignment: result.tokenAlignment,
          sourceEmbedding: embedding,
        })
      }

      if (reservation) {
        const cost = computeCredits(
          result.tokenUsage.promptTokens,
          result.tokenUsage.completionTokens,
          result.tokenUsage.modelId,
          target.creditCostMultiplier,
        )
        await reconcileSpend(db, userId, reservation, cost, row.id)
        reservation = null
      }

      await logActivity(db, userId, 'segment.created', {
        threadId: payload.threadId,
        vibe: resolvedVibe,
        byok: target.isByok,
      })
      return c.json(mapSegment(row), 201)
    } catch (error) {
      // Release the hold on any failure before the spend was reconciled.
      if (reservation) await refundReservation(db, userId, reservation).catch(() => undefined)
      throw error
    }
  })
})

// Manual edit to stored history (a learner tweaking a past translation).
app.patch('/api/segments/:segmentId', zValidator('json', segmentUpdateSchema), (c) => {
  const updates = c.req.valid('json')
  const userId = c.get('userId')
  const id = c.req.param('segmentId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const owner = await db.query<{ user_id: string }>(
      `select user_id from segments where id = $1`,
      [id],
    )
    if (!owner.rows[0]) throw new HTTPException(404, { message: 'Segment not found' })
    assertUserOwnsResource(owner.rows[0].user_id, userId)

    const columnByKey: Record<string, string> = {
      sourceText: 'source_text',
      targetText: 'target_text',
      vibe: 'vibe',
      tokenAlignment: 'token_alignment',
    }
    const fields: Array<[string, unknown]> = []
    for (const [key, col] of Object.entries(columnByKey)) {
      const value = (updates as Record<string, unknown>)[key]
      if (value !== undefined) fields.push([col, key === 'tokenAlignment' ? JSON.stringify(value) : value])
    }
    if (fields.length > 0) {
      const setClause = fields.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      await db.query(`update segments set ${setClause}, updated_at = now() where id = $1`, [
        id,
        ...fields.map(([, value]) => value),
      ])
    }
    const res = await db.query<SegmentDbRow>(
      `select ${SEGMENT_COLUMNS} from segments where id = $1`,
      [id],
    )
    return c.json(mapSegment(res.rows[0]))
  })
})

app.delete('/api/segments/:segmentId', (c) => {
  const userId = c.get('userId')
  const id = c.req.param('segmentId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query(`delete from segments where id = $1 and user_id = $2`, [id, userId])
    if (res.rowCount === 0) throw new HTTPException(404, { message: 'Segment not found' })
    return c.json({ ok: true, id })
  })
})

// Generate-on-miss, cache-in-DB Explain (Pro+). Lookup order:
//   1) explains where (segment_id, version = EXPLAIN_PAYLOAD_VERSION)
//   2) explains where (user_id, target_language, target_text_hash, version)
//      — cross-segment reuse for repeated target text
//   3) generate via api/_lib/explain.ts, insert, charge, return
app.get('/api/segments/:segmentId/explain', (c) => {
  const userId = c.get('userId')
  const segmentId = c.req.param('segmentId')
  return withDb(c.env, async (db) => {
    const user = await getOrCreateUser(db, userId, c.get('email'))
    canUseFeature(tierLimits[user.tier].explain)

    const segRes = await db.query<{
      user_id: string
      source_text: string
      target_text: string
      source_language: string
      target_language: string
      persona: Persona
    }>(
      `select s.user_id, s.source_text, s.target_text,
              c.source_language, c.target_language, c.persona
         from segments s
         join threads t on t.id = s.thread_id
         join characters c on c.id = t.character_id
        where s.id = $1`,
      [segmentId],
    )
    const segment = segRes.rows[0]
    if (!segment) throw new HTTPException(404, { message: 'Segment not found' })
    assertUserOwnsResource(segment.user_id, userId)

    // Lookup 1: this segment at the current version.
    const direct = await db.query<{ body: Record<string, unknown> }>(
      `select body from explains where segment_id = $1 and version = $2`,
      [segmentId, EXPLAIN_PAYLOAD_VERSION],
    )
    if (direct.rows[0]) {
      return c.json({ segmentId, version: EXPLAIN_PAYLOAD_VERSION, body: direct.rows[0].body, cached: true })
    }

    // Lookup 2: cross-segment reuse for identical target text.
    const targetHash = await sha256Hex(segment.target_text)
    const shared = await db.query<{ body: Record<string, unknown> }>(
      `select body from explains
        where user_id = $1 and target_language = $2 and target_text_hash = $3 and version = $4
        limit 1`,
      [userId, segment.target_language, targetHash, EXPLAIN_PAYLOAD_VERSION],
    )
    if (shared.rows[0]) {
      return c.json({ segmentId, version: EXPLAIN_PAYLOAD_VERSION, body: shared.rows[0].body, cached: true })
    }

    // Miss → resolve target, reserve credits (platform path), generate, insert,
    // reconcile. The atomic reservation gates concurrency; it is refunded if the
    // model call fails.
    const target = await resolveCallTarget(db, c.env, userId, 'explain')
    let reservation: Reservation | null = null
    if (!target.isByok) {
      const estimate = estimateCredits(
        `${segment.source_text}\n${segment.target_text}`,
        target.creditCostMultiplier,
      )
      reservation = await reserveCredits(db, userId, estimate, 'spend.explain')
      if (!reservation) {
        throw new HTTPException(402, {
          message: 'Insufficient credits — add credits or configure BYOK',
        })
      }
    }

    try {
      const result = await generateExplain(
        {
          sourceText: segment.source_text,
          sourceLanguage: segment.source_language,
          targetText: segment.target_text,
          targetLanguage: segment.target_language,
          persona: segment.persona,
        },
        { apiKey: target.apiKey, modelId: target.modelId, appUrl: c.env.APP_URL, reasoning: target.reasoning },
      )
      const inserted = await db.query<{ id: string }>(
        `insert into explains
           (segment_id, user_id, target_language, target_text, target_text_hash, version, body, token_usage)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [
          segmentId,
          userId,
          segment.target_language,
          segment.target_text,
          targetHash,
          result.version,
          JSON.stringify(result.body),
          JSON.stringify(result.tokenUsage),
        ],
      )
      if (reservation) {
        const cost = computeCredits(
          result.tokenUsage.promptTokens,
          result.tokenUsage.completionTokens,
          result.tokenUsage.modelId,
          target.creditCostMultiplier,
        )
        await reconcileSpend(db, userId, reservation, cost, inserted.rows[0].id)
        reservation = null
      }
      return c.json({ segmentId, version: result.version, body: result.body, cached: false })
    } catch (error) {
      if (reservation) await refundReservation(db, userId, reservation).catch(() => undefined)
      throw error
    }
  })
})

// Translation Memory search. Embeds `q`, runs cosine similarity against the
// user's segments.source_embedding (optionally scoped to a character or
// target language), returns top-K with similarity scores.
app.get('/api/memory', zValidator('query', memorySearchSchema), (c) => {
  const params = c.req.valid('query')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    const user = await getOrCreateUser(db, userId, c.get('email'))
    canUseFeature(tierLimits[user.tier].translationMemory)

    const embed = await embedText({ text: params.q, apiKey: c.env.OPENROUTER_API_KEY ?? '' })
    const vector = formatVector(embed.vector)

    // $1 user, $2 query vector, $3 limit; optional filters start at $4.
    const filters = ['s.user_id = $1', 's.source_embedding is not null']
    const values: unknown[] = [userId, vector, params.limit]
    let p = 3
    if (params.characterId) {
      p += 1
      filters.push(`t.character_id = $${p}`)
      values.push(params.characterId)
    }
    if (params.targetLanguage) {
      p += 1
      filters.push(`c.target_language = $${p}`)
      values.push(params.targetLanguage)
    }

    const res = await db.query<{ segment_id: string; similarity: number }>(
      `select s.id as segment_id, 1 - (s.source_embedding <=> $2::vector) as similarity
         from segments s
         join threads t on t.id = s.thread_id
         join characters c on c.id = t.character_id
        where ${filters.join(' and ')}
        order by s.source_embedding <=> $2::vector asc
        limit $3`,
      values,
    )
    return c.json({
      query: params.q,
      characterId: params.characterId ?? null,
      targetLanguage: params.targetLanguage ?? null,
      hits: res.rows.map((r) => ({ segmentId: r.segment_id, similarity: Number(r.similarity) })),
    })
  })
})

app.get('/api/activity', (c) => {
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    await getOrCreateUser(db, userId, c.get('email'))
    const res = await db.query<{
      id: string
      action: string
      metadata: Record<string, unknown>
      created_at: string | Date
    }>(
      `select id, action, metadata, created_at from activity_log
        where user_id = $1 order by created_at desc limit 100`,
      [userId],
    )
    return c.json(
      res.rows.map((r) => ({
        id: r.id,
        action: r.action,
        metadata: r.metadata,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    )
  })
})

// Free, one-shot onboarding dictation. Parses a free-form description into a
// Character draft for the confirmation form. `ok: false` → client falls back to
// the empty form. Does not charge credits; should be rate-limited per user and
// only served while onboarding_complete = false.
app.post('/api/onboarding/dictate', zValidator('json', onboardingDictateSchema), (c) => {
  const { prompt } = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    const user = await getOrCreateUser(db, userId, c.get('email'))
    if (user.onboardingComplete) {
      throw new HTTPException(403, { message: 'Onboarding is already complete' })
    }
    // Soft per-user rate limit: at most 5 onboarding dictations per minute.
    const recent = await db.query<{ count: number }>(
      `select count(*)::int as count from activity_log
        where user_id = $1 and action = 'onboarding.dictate'
          and created_at > now() - interval '1 minute'`,
      [userId],
    )
    if (Number(recent.rows[0]?.count ?? 0) >= 5) {
      throw new HTTPException(429, { message: 'Too many dictation attempts — please slow down' })
    }
    await logActivity(db, userId, 'onboarding.dictate', {})

    // Free / platform-paid; dictation is never BYOK.
    const target = await resolveCallTarget(db, c.env, userId, 'dictation')
    const { draft } = await draftCharacterFromDictation(prompt, {
      apiKey: target.apiKey,
      modelId: target.modelId,
      appUrl: c.env.APP_URL,
      reasoning: target.reasoning,
    })
    return c.json({ ...draft, prompt })
  })
})

// In-app dictation (Pro+, credit-charged). Same parse, used to spin up
// additional Characters by voice after onboarding.
app.post('/api/ai/dictation', zValidator('json', onboardingDictateSchema), (c) => {
  const { prompt } = c.req.valid('json')
  const userId = c.get('userId')
  return withDb(c.env, async (db) => {
    const user = await getOrCreateUser(db, userId, c.get('email'))
    canUseFeature(tierLimits[user.tier].aiDictation)

    // Dictation is always platform-paid (never BYOK; see adr/0003). Reserve a
    // hold before the call so concurrent requests can't bypass a stale balance
    // read, then reconcile to the real cost — or refund when the parse degrades
    // to the empty-form fallback and there's nothing billable.
    const target = await resolveCallTarget(db, c.env, userId, 'dictation')
    const estimate = estimateCredits(prompt, target.creditCostMultiplier)
    const reservation = await reserveCredits(db, userId, estimate, 'spend.dictation')
    if (!reservation) {
      throw new HTTPException(402, { message: 'Insufficient credits — add credits to continue' })
    }

    const { draft, tokenUsage } = await draftCharacterFromDictation(prompt, {
      apiKey: target.apiKey,
      modelId: target.modelId,
      appUrl: c.env.APP_URL,
      reasoning: target.reasoning,
    })
    if (tokenUsage) {
      const cost = computeCredits(
        tokenUsage.promptTokens,
        tokenUsage.completionTokens,
        tokenUsage.modelId,
        target.creditCostMultiplier,
      )
      await reconcileSpend(db, userId, reservation, cost, null)
    } else {
      await refundReservation(db, userId, reservation)
    }
    return c.json({ ...draft, prompt })
  })
})

function getProviderErrorMessage(status: number, body: string) {
  // Log the upstream body server-side; return a generic, status-only message so
  // provider internals (and request ids) aren't surfaced in API responses.
  if (body.trim()) console.error('text-to-speech provider error', { status, detail: body.slice(0, 500) })
  return `Text-to-speech provider request failed (${status})`
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

async function getSubscriptionId(env: AppEnv['Bindings'], userId: string): Promise<string | null> {
  const db = createDbClient(env)
  try {
    await db.connect()
    const result = await db.query<{ subscription_id: string | null }>(
      `select subscription_id from users where clerk_user_id = $1`,
      [userId],
    )
    return result.rows[0]?.subscription_id ?? null
  } finally {
    await db.end().catch(() => undefined)
  }
}

app.post('/api/billing/checkout', zValidator('json', checkoutSchema), async (c) => {
  const { plan, billingPeriod } = c.req.valid('json')
  const { checkoutUrl } = await createCheckoutSession({
    env: c.env,
    plan,
    billingPeriod,
    userId: c.get('userId'),
    email: c.get('email'),
  })
  return c.json({ checkoutUrl, plan })
})

app.post('/api/billing/cancel', async (c) => {
  const subscriptionId = await getSubscriptionId(c.env, c.get('userId'))
  if (!subscriptionId) {
    throw new HTTPException(409, { message: 'No active subscription to cancel' })
  }
  await cancelSubscription(c.env, subscriptionId)
  return c.json({ ok: true })
})

app.post('/api/billing/switch-plan', zValidator('json', checkoutSchema), async (c) => {
  const { plan, billingPeriod } = c.req.valid('json')
  const subscriptionId = await getSubscriptionId(c.env, c.get('userId'))
  if (!subscriptionId) {
    throw new HTTPException(409, { message: 'No active subscription to change' })
  }
  await switchPlan({ env: c.env, subscriptionId, plan, billingPeriod })
  return c.json({ ok: true, plan })
})

app.post('/api/billing/webhooks/dodo', async (c) => {
  const secret = c.env.DODO_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new HTTPException(500, { message: 'DODO_WEBHOOK_SECRET is not configured' })
  }

  // Verify the signature on the RAW body before parsing or touching the DB.
  const rawBody = await c.req.text()
  const verified = await verifyDodoSignature(rawBody, c.req.raw.headers, secret)
  if (!verified) {
    throw new HTTPException(400, { message: 'Invalid webhook signature' })
  }

  const eventId = c.req.header('webhook-id')
  if (!eventId) {
    throw new HTTPException(400, { message: 'Missing webhook-id header' })
  }

  let event: DodoEvent
  try {
    event = JSON.parse(rawBody) as DodoEvent
  } catch {
    throw new HTTPException(400, { message: 'Malformed webhook body' })
  }

  const db = createDbClient(c.env)
  try {
    await db.connect()
    const result = await processDodoWebhook(db, c.env, eventId, event)

    // Best-effort confirmation email on a fresh activation, sent AFTER the
    // transaction commits. An email failure must never fail the webhook ack.
    if (result.status === 'processed' && result.activated && result.userId && result.plan !== 'free') {
      const emailRow = await db.query<{ email: string | null }>(
        `select email from users where clerk_user_id = $1`,
        [result.userId],
      )
      const to = emailRow.rows[0]?.email
      if (to && result.plan) {
        const { subject, html, text } = subscriptionConfirmationEmail({ plan: result.plan })
        await sendTransactionalEmail({ env: c.env, to, subject, html, text }).catch((error) =>
          console.error('subscription confirmation email failed', error),
        )
      }
    }

    return c.json({ ok: true, status: result.status })
  } finally {
    await db.end().catch(() => undefined)
  }
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
