import { HTTPException } from 'hono/http-exception'
import type { Client } from 'pg'

import type { Bindings } from './env'
import { logActivity } from './activity'
import { tierLimits, type Tier } from './tier'

// Dodo Payments commerce: Standard-Webhooks signature verification + checkout/
// subscription lifecycle handling. Verification runs on the raw body before any
// parsing or state mutation. See docs/SECURITY.md#webhook-signatures and
// docs/adr/0005.

// Reject webhooks whose timestamp is outside this window (replay guard).
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export type PaidPlan = 'pro' | 'team'
export type BillingPeriod = 'monthly' | 'annual'

// ---------------------------------------------------------------------------
// Dodo REST helpers (raw fetch — no SDK, mirroring the ElevenLabs pattern)
// ---------------------------------------------------------------------------

function dodoBaseUrl(env: Bindings): string {
  return env.APP_ENV === 'production'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com'
}

function dodoProductId(env: Bindings, plan: PaidPlan, period: BillingPeriod): string | undefined {
  if (plan === 'pro') return period === 'annual' ? env.DODO_PRODUCT_PRO_ANNUAL : env.DODO_PRODUCT_PRO
  return period === 'annual' ? env.DODO_PRODUCT_TEAM_ANNUAL : env.DODO_PRODUCT_TEAM
}

async function dodoFetch(env: Bindings, path: string, init: RequestInit): Promise<Response> {
  const apiKey = env.DODO_API_KEY?.trim()
  if (!apiKey) {
    throw new HTTPException(503, { message: 'Dodo Payments is not configured' })
  }
  return fetch(`${dodoBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

async function dodoErrorMessage(res: Response, action: string): Promise<never> {
  // Log the upstream detail server-side; return only a generic message + status
  // to the client so provider internals aren't surfaced in API responses.
  const detail = await res.text().catch(() => '')
  if (detail) console.error(`dodo ${action} failed`, { status: res.status, detail: detail.slice(0, 500) })
  throw new HTTPException(502, { message: `Dodo ${action} failed (${res.status})` })
}

// ---------------------------------------------------------------------------
// Checkout & subscription management
// ---------------------------------------------------------------------------

// Creates a hosted Dodo checkout session for a plan upgrade. Stamps
// metadata.clerk_user_id so the resulting subscription webhook can resolve the
// user (see adr/0005). Returns the hosted checkout URL to redirect the browser to.
export async function createCheckoutSession(params: {
  env: Bindings
  plan: PaidPlan
  billingPeriod: BillingPeriod
  userId: string
  email: string | null
}): Promise<{ checkoutUrl: string }> {
  const { env, plan, billingPeriod, userId, email } = params

  const productId = dodoProductId(env, plan, billingPeriod)
  if (!productId) {
    throw new HTTPException(503, {
      message: `No Dodo product configured for ${plan}/${billingPeriod}`,
    })
  }
  if (!email) {
    throw new HTTPException(400, { message: 'A billing email is required to start checkout' })
  }

  const res = await dodoFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email },
      return_url: `${env.APP_URL ?? ''}/app?upgraded=1`,
      metadata: { clerk_user_id: userId, plan },
    }),
  })
  if (!res.ok) await dodoErrorMessage(res, 'checkout')

  const body = (await res.json().catch(() => ({}))) as { checkout_url?: string | null }
  if (!body.checkout_url) {
    throw new HTTPException(502, { message: 'Dodo did not return a checkout URL' })
  }
  return { checkoutUrl: body.checkout_url }
}

// Cancels at the end of the current billing period (keeps access until then).
// The tier downgrade is applied later by the `subscription.cancelled` webhook,
// not here — webhooks are the single source of truth for entitlement state.
export async function cancelSubscription(env: Bindings, subscriptionId: string): Promise<void> {
  const res = await dodoFetch(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ cancel_at_next_billing_date: true }),
  })
  if (!res.ok) await dodoErrorMessage(res, 'cancel')
}

// Switches an active subscription to a different plan, prorated immediately.
// The tier/credit change is applied by the `subscription.plan_changed` webhook.
export async function switchPlan(params: {
  env: Bindings
  subscriptionId: string
  plan: PaidPlan
  billingPeriod: BillingPeriod
}): Promise<void> {
  const { env, subscriptionId, plan, billingPeriod } = params

  const productId = dodoProductId(env, plan, billingPeriod)
  if (!productId) {
    throw new HTTPException(503, {
      message: `No Dodo product configured for ${plan}/${billingPeriod}`,
    })
  }

  const res = await dodoFetch(env, `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      quantity: 1,
      proration_billing_mode: 'prorated_immediately',
    }),
  })
  if (!res.ok) await dodoErrorMessage(res, 'change-plan')
}

// ---------------------------------------------------------------------------
// Signature verification (Standard Webhooks spec, which Dodo follows)
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Constant-time string compare to avoid leaking signature bytes via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

// Verifies a Dodo webhook against the Standard Webhooks scheme: the signed
// content is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with
// the base64-decoded secret, base64-compared against each space-delimited
// `v1,<sig>` entry in the `webhook-signature` header.
export async function verifyDodoSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > SIGNATURE_TOLERANCE_SECONDS) return false

  // Standard Webhooks secrets are base64, optionally prefixed `whsec_`.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(rawSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    return false
  }

  const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)
  const expected = bytesToBase64(await crypto.subtle.sign('HMAC', key, signed))

  // Header is a space-delimited list of `<version>,<base64sig>` entries.
  for (const entry of signatureHeader.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma === -1) continue
    const version = entry.slice(0, comma)
    const value = entry.slice(comma + 1)
    if (version === 'v1' && value && timingSafeEqual(value, expected)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

// Permissive shape — we read only the fields we need and ignore the rest.
export type DodoEvent = {
  type?: string
  data?: {
    subscription_id?: string
    product_id?: string
    metadata?: Record<string, string> | null
  } | null
}

export type WebhookResult = {
  status: 'processed' | 'deduped' | 'ignored'
  userId?: string
  plan?: Tier
  activated?: boolean
}

// Plan from checkout metadata (primary), falling back to the product id map.
function resolvePlan(env: Bindings, data: NonNullable<DodoEvent['data']>): Tier | undefined {
  const fromMeta = data.metadata?.plan
  if (fromMeta === 'pro' || fromMeta === 'team') return fromMeta

  const productId = data.product_id
  if (productId) {
    if (productId === env.DODO_PRODUCT_PRO || productId === env.DODO_PRODUCT_PRO_ANNUAL) return 'pro'
    if (productId === env.DODO_PRODUCT_TEAM || productId === env.DODO_PRODUCT_TEAM_ANNUAL) return 'team'
  }
  return undefined
}

// User from checkout metadata (primary), falling back to the stored
// subscription id for lifecycle events that omit metadata. Email is
// deliberately NOT used — Clerk and Dodo billing emails can drift (adr/0005).
async function resolveUserId(
  db: Client,
  data: NonNullable<DodoEvent['data']>,
  subscriptionId: string | undefined,
): Promise<string | undefined> {
  const fromMeta = data.metadata?.clerk_user_id
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta

  if (subscriptionId) {
    const result = await db.query<{ clerk_user_id: string }>(
      `select clerk_user_id from users where subscription_id = $1`,
      [subscriptionId],
    )
    if (result.rows[0]?.clerk_user_id) return result.rows[0].clerk_user_id
  }
  return undefined
}

// Sets tier + subscription id and grants the new tier's credit allowance.
// Runs INLINE in the caller's transaction (so it is atomic with the
// webhook_events dedupe insert) — that is why it does not use credits.recordGrant,
// which opens its own transaction. The accounting mirrors recordGrant: add the
// allowance as a positive ledger delta and keep users.credits_balance in sync.
async function applySubscriptionGrant(
  db: Client,
  userId: string,
  plan: Tier,
  subscriptionId: string | undefined,
  isRenewal: boolean,
): Promise<void> {
  const credits = tierLimits[plan].credits
  // Guarantee the FK target exists before the credit_ledger insert below: a user
  // can reach checkout (and thus this webhook) before any authenticated DB route
  // has lazily created their row via getOrCreateUser. We can't call
  // getOrCreateUser here — it opens its own transaction (recordGrant), and we're
  // already inside the webhook's transaction — so insert the bare row directly.
  // No signup grant is applied; getOrCreateUser stays the single owner of that.
  await db.query(
    `insert into users (clerk_user_id) values ($1)
     on conflict (clerk_user_id) do nothing`,
    [userId],
  )
  await db.query(
    `update users
        set tier = $2,
            subscription_id = coalesce($3, subscription_id),
            credits_balance = credits_balance + $4,
            credits_refilled_at = now(),
            updated_at = now()
      where clerk_user_id = $1`,
    [userId, plan, subscriptionId ?? null, credits],
  )
  await db.query(
    `insert into credit_ledger (user_id, delta, reason, metadata)
     values ($1, $2, $3, $4)`,
    [
      userId,
      credits,
      isRenewal ? 'grant.monthly' : 'grant.subscription',
      JSON.stringify({ plan, subscriptionId }),
    ],
  )
}

// Applies one Dodo event to user state. Assumes the caller holds an open
// transaction; performs no begin/commit of its own.
async function handleDodoEvent(
  db: Client,
  env: Bindings,
  event: DodoEvent,
): Promise<WebhookResult> {
  const data = event.data ?? {}
  const subscriptionId = typeof data.subscription_id === 'string' ? data.subscription_id : undefined

  switch (event.type) {
    case 'subscription.active':
    case 'subscription.plan_changed':
    case 'subscription.renewed': {
      const plan = resolvePlan(env, data)
      const userId = await resolveUserId(db, data, subscriptionId)
      if (!plan || !userId) {
        console.warn('dodo webhook: could not resolve plan/user', {
          type: event.type,
          hasPlan: Boolean(plan),
          subscriptionId,
        })
        return { status: 'ignored' }
      }
      const isRenewal = event.type === 'subscription.renewed'
      await applySubscriptionGrant(db, userId, plan, subscriptionId, isRenewal)
      await logActivity(db, userId, isRenewal ? 'tier.renewed' : 'tier.upgraded', {
        plan,
        subscriptionId,
      })
      // `activated` drives the one-time confirmation email: only first
      // activation, not renewals or plan changes (which would re-send an
      // "activated" email on every upgrade/downgrade).
      return { status: 'processed', userId, plan, activated: event.type === 'subscription.active' }
    }

    case 'subscription.failed': {
      // A failed charge is often transient (dunning / provider retry). Drop the
      // user to free, but KEEP subscription_id so a later recovery event that
      // lacks checkout metadata can still resolve them via resolveUserId. Only
      // terminal teardown (cancelled/expired) clears subscription_id. See adr/0005.
      const userId = await resolveUserId(db, data, subscriptionId)
      if (!userId) {
        console.warn('dodo webhook: could not resolve user for payment failure', {
          type: event.type,
          subscriptionId,
        })
        return { status: 'ignored' }
      }
      await db.query(
        `update users set tier = 'free', updated_at = now() where clerk_user_id = $1`,
        [userId],
      )
      await logActivity(db, userId, 'tier.downgraded', { reason: event.type, subscriptionId })
      return { status: 'processed', userId, plan: 'free', activated: false }
    }

    case 'subscription.cancelled':
    case 'subscription.expired': {
      const userId = await resolveUserId(db, data, subscriptionId)
      if (!userId) {
        console.warn('dodo webhook: could not resolve user for termination', {
          type: event.type,
          subscriptionId,
        })
        return { status: 'ignored' }
      }
      await db.query(
        `update users
            set tier = 'free', subscription_id = null, updated_at = now()
          where clerk_user_id = $1`,
        [userId],
      )
      await logActivity(db, userId, 'tier.downgraded', { reason: event.type, subscriptionId })
      return { status: 'processed', userId, plan: 'free', activated: false }
    }

    default:
      return { status: 'ignored' }
  }
}

// Idempotent entry point for the webhook route. Inserts the dedupe row and
// applies the event in ONE transaction: a redelivered event_id is dropped
// before any grant runs, and a mid-flight failure rolls back the dedupe row so
// the provider's retry is processed cleanly.
export async function processDodoWebhook(
  db: Client,
  env: Bindings,
  eventId: string,
  event: DodoEvent,
): Promise<WebhookResult> {
  await db.query('begin')
  try {
    const inserted = await db.query(
      `insert into webhook_events (event_id, source, event_type)
       values ($1, 'dodo', $2)
       on conflict (event_id) do nothing`,
      [eventId, event.type ?? null],
    )
    if (inserted.rowCount === 0) {
      await db.query('commit')
      return { status: 'deduped' }
    }
    const result = await handleDodoEvent(db, env, event)
    await db.query('commit')
    return result
  } catch (error) {
    await db.query('rollback').catch(() => undefined)
    throw error
  }
}
