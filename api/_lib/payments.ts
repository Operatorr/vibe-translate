import { HTTPException } from 'hono/http-exception'
import type { Client } from 'pg'
import { z } from 'zod'

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

const CREDIT_PACKS = [
  { id: 'small', credits: 25000, envKey: 'DODO_PRODUCT_CREDITS_SMALL' },
  { id: 'medium', credits: 50000, envKey: 'DODO_PRODUCT_CREDITS_MEDIUM' },
  { id: 'large', credits: 100000, envKey: 'DODO_PRODUCT_CREDITS_LARGE' },
] as const
type CreditPackId = (typeof CREDIT_PACKS)[number]['id']
const productPriceSchema = z.object({
  price: z.object({
    type: z.literal('one_time_price'),
    price: z.number().int().nonnegative(),
    currency: z.string().length(3),
    discount: z.number().min(0).max(100).optional(),
    discount_bps: z.number().min(0).max(10000).nullish(),
    pay_what_you_want: z.boolean().optional(),
  }),
})

async function loadCreditPack(
  env: Bindings,
  pack: (typeof CREDIT_PACKS)[number],
) {
  const productId = env[pack.envKey]?.trim()
  const result = {
    id: pack.id,
    credits: pack.credits,
    available: false,
    price: null as { amount: number; currency: string } | null,
  }
  if (!env.DODO_API_KEY?.trim() || !productId) return result
  const res = await dodoFetch(
    env,
    `/products/${encodeURIComponent(productId)}`,
    { method: 'GET' },
  )
  if (!res.ok) return result
  const product = productPriceSchema.safeParse(await res.json())
  if (!product.success || product.data.price.pay_what_you_want) return result
  const price = product.data.price
  const discount = price.discount_bps ?? (price.discount ?? 0) * 100
  return {
    ...result,
    available: true,
    price: {
      amount: Math.round((price.price * (10000 - discount)) / 10000),
      currency: price.currency,
    },
  }
}

export async function creditPacks(env: Bindings) {
  // Catalog failures must not hide the user's balance and history.
  return Promise.all(
    CREDIT_PACKS.map(async (pack) => {
      try {
        return await loadCreditPack(env, pack)
      } catch {
        return {
          id: pack.id,
          credits: pack.credits,
          available: false,
          price: null,
        }
      }
    }),
  )
}

export async function createCreditCheckout(params: {
  db: Client
  env: Bindings
  userId: string
  email: string | null
  pack: CreditPackId
}): Promise<{ checkoutUrl: string }> {
  const { db, env, userId, email } = params
  const definition = CREDIT_PACKS.find((pack) => pack.id === params.pack)!
  const pack = await loadCreditPack(env, definition)
  const productId = env[definition.envKey]?.trim()
  if (!pack.available || !productId) {
    throw new HTTPException(503, {
      message: 'Credit top-ups are not available yet',
    })
  }
  if (!email)
    throw new HTTPException(400, { message: 'A billing email is required' })
  const order = await db.query<{ id: string }>(
    `insert into credit_purchases (user_id, product_id, quantity, credits)
     values ($1, $2, $3, $4) returning id`,
    [userId, productId, 1, pack.credits],
  )
  const orderId = order.rows[0].id
  const res = await dodoFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email },
      return_url: `${env.APP_URL ?? ''}/app/credits?orderId=${orderId}`,
      metadata: { user_id: userId, kind: 'credit_topup', order_id: orderId },
    }),
  })
  if (!res.ok) await dodoErrorMessage(res, 'credit checkout')
  const body = (await res.json().catch(() => ({}))) as {
    checkout_url?: string | null
  }
  if (!body.checkout_url) {
    throw new HTTPException(502, {
      message: 'Dodo did not return a checkout URL',
    })
  }
  return { checkoutUrl: body.checkout_url }
}

// ---------------------------------------------------------------------------
// Dodo REST helpers (raw fetch — no SDK, mirroring the ElevenLabs pattern)
// ---------------------------------------------------------------------------

function dodoBaseUrl(env: Bindings): string {
  return env.APP_ENV === 'production'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com'
}

function dodoProductId(
  env: Bindings,
  plan: PaidPlan,
  period: BillingPeriod,
): string | undefined {
  if (plan === 'pro')
    return period === 'annual'
      ? env.DODO_PRODUCT_PRO_ANNUAL
      : env.DODO_PRODUCT_PRO
  return period === 'annual'
    ? env.DODO_PRODUCT_TEAM_ANNUAL
    : env.DODO_PRODUCT_TEAM
}

async function dodoFetch(
  env: Bindings,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const apiKey = env.DODO_API_KEY?.trim()
  if (!apiKey) {
    throw new HTTPException(503, { message: 'Dodo Payments is not configured' })
  }
  return fetch(`${dodoBaseUrl(env)}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000),
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
  if (detail)
    console.error(`dodo ${action} failed`, {
      status: res.status,
      detail: detail.slice(0, 500),
    })
  throw new HTTPException(502, {
    message: `Dodo ${action} failed (${res.status})`,
  })
}

// ---------------------------------------------------------------------------
// Checkout & subscription management
// ---------------------------------------------------------------------------

// Creates a hosted Dodo checkout session for a plan upgrade. Stamps
// metadata.user_id so the resulting subscription webhook can resolve the
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
    throw new HTTPException(400, {
      message: 'A billing email is required to start checkout',
    })
  }

  const res = await dodoFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email },
      return_url: `${env.APP_URL ?? ''}/app?upgraded=1`,
      metadata: { user_id: userId, plan },
    }),
  })
  if (!res.ok) await dodoErrorMessage(res, 'checkout')

  const body = (await res.json().catch(() => ({}))) as {
    checkout_url?: string | null
  }
  if (!body.checkout_url) {
    throw new HTTPException(502, {
      message: 'Dodo did not return a checkout URL',
    })
  }
  return { checkoutUrl: body.checkout_url }
}

// Cancels at the end of the current billing period (keeps access until then).
// The tier downgrade is applied later by the `subscription.cancelled` webhook,
// not here — webhooks are the single source of truth for entitlement state.
export async function cancelSubscription(
  env: Bindings,
  subscriptionId: string,
): Promise<void> {
  const res = await dodoFetch(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ cancel_at_next_billing_date: true }),
    },
  )
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

  const res = await dodoFetch(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`,
    {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        quantity: 1,
        proration_billing_mode: 'prorated_immediately',
      }),
    },
  )
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
  for (let i = 0; i < bytes.length; i += 1)
    binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Constant-time string compare to avoid leaking signature bytes via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
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
  const rawSecret = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret

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
    if (version === 'v1' && value && timingSafeEqual(value, expected))
      return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

// Permissive shape — we read only the fields we need and ignore the rest.
export const dodoEventSchema = z.object({
  type: z.string(),
  data: z
    .object({
      subscription_id: z.string().nullish(),
      subscription_ids: z.array(z.string()).optional(),
      product_id: z.string().optional(),
      payment_id: z.string().optional(),
      status: z.string().nullish(),
      product_cart: z
        .array(
          z.object({
            product_id: z.string(),
            quantity: z.number().int().positive(),
          }),
        )
        .nullish(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
})
export type DodoEvent = z.infer<typeof dodoEventSchema>

export type WebhookResult = {
  status: 'processed' | 'deduped' | 'ignored'
  userId?: string
  plan?: Tier
  activated?: boolean
}

// Plan from checkout metadata (primary), falling back to the product id map.
function resolvePlan(
  env: Bindings,
  data: NonNullable<DodoEvent['data']>,
): Tier | undefined {
  const fromMeta = data.metadata?.plan
  if (fromMeta === 'pro' || fromMeta === 'team') return fromMeta

  const productId = data.product_id
  if (productId) {
    if (
      productId === env.DODO_PRODUCT_PRO ||
      productId === env.DODO_PRODUCT_PRO_ANNUAL
    )
      return 'pro'
    if (
      productId === env.DODO_PRODUCT_TEAM ||
      productId === env.DODO_PRODUCT_TEAM_ANNUAL
    )
      return 'team'
  }
  return undefined
}

// User from checkout metadata (primary), falling back to the stored
// subscription id for lifecycle events that omit metadata. Email is
// deliberately NOT used — account and Dodo billing emails can drift (adr/0005).
async function resolveUserId(
  db: Client,
  data: NonNullable<DodoEvent['data']>,
  subscriptionId: string | undefined,
): Promise<string | undefined> {
  const fromMeta = data.metadata?.user_id
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta

  if (subscriptionId) {
    const result = await db.query<{ auth_user_id: string }>(
      `select auth_user_id from users where subscription_id = $1`,
      [subscriptionId],
    )
    if (result.rows[0]?.auth_user_id) return result.rows[0].auth_user_id
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
  // may arrive through an external or legacy checkout. Our checkout route
  // already provisions the profile and email via getOrCreateUser. We don't call
  // it here on purpose: first-use provisioning also credits the free signup
  // grant, and a webhook should apply only the plan allowance below (it has no
  // session email to store either). The bare row gets no signup grant;
  // getOrCreateUser stays the single owner of that.
  await db.query(
    `insert into users (auth_user_id) values ($1)
     on conflict (auth_user_id) do nothing`,
    [userId],
  )
  await db.query(
    `update users
        set tier = $2,
            subscription_id = coalesce($3, subscription_id),
            credits_balance = credits_balance + $4,
            credits_refilled_at = now(),
            updated_at = now()
      where auth_user_id = $1`,
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
  const subscriptionId =
    typeof data.subscription_id === 'string' ? data.subscription_id : undefined

  switch (event.type) {
    case 'payment.succeeded': {
      // Subscription payments have their own allowance path. Never grant from
      // redirect parameters, client-supplied credit amounts, or metadata alone.
      if (data.metadata?.kind !== 'credit_topup') return { status: 'ignored' }
      const orderId = z.uuid().safeParse(data.metadata.order_id)
      if (
        !orderId.success ||
        !data.payment_id ||
        data.status !== 'succeeded' ||
        subscriptionId ||
        data.subscription_ids?.length
      ) {
        throw new HTTPException(400, { message: 'Invalid credit payment' })
      }
      const orders = await db.query<{
        user_id: string
        product_id: string
        quantity: number
        credits: number
        payment_id: string | null
        fulfilled_at: Date | null
      }>(
        `select user_id, product_id, quantity, credits, payment_id, fulfilled_at
            from credit_purchases where id = $1 for update`,
        [orderId.data],
      )
      const order = orders.rows[0]
      if (!order)
        throw new HTTPException(400, { message: 'Unknown credit order' })
      const cart = data.product_cart
      if (
        data.metadata.user_id !== order.user_id ||
        !cart ||
        cart.length !== 1 ||
        cart[0].product_id !== order.product_id ||
        cart[0].quantity !== order.quantity
      ) {
        throw new HTTPException(400, {
          message: 'Credit payment does not match its order',
        })
      }
      if (order.fulfilled_at) {
        if (order.payment_id !== data.payment_id) {
          throw new HTTPException(400, { message: 'Credit order already paid' })
        }
        return { status: 'deduped' }
      }
      // Unique payment_id also prevents using one payment for two orders.
      await db.query(
        `update credit_purchases set payment_id = $2, fulfilled_at = now()
                       where id = $1`,
        [orderId.data, data.payment_id],
      )
      await db.query(
        `update users set credits_balance = credits_balance + $2,
                       updated_at = now() where auth_user_id = $1`,
        [order.user_id, order.credits],
      )
      await db.query(
        `insert into credit_ledger (user_id, delta, reason, reference_id, metadata)
                       values ($1, $2, 'grant.purchase', $3, $4)`,
        [
          order.user_id,
          order.credits,
          orderId.data,
          JSON.stringify({ paymentId: data.payment_id }),
        ],
      )
      return { status: 'processed', userId: order.user_id }
    }
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
      await logActivity(
        db,
        userId,
        isRenewal ? 'tier.renewed' : 'tier.upgraded',
        {
          plan,
          subscriptionId,
        },
      )
      // `activated` drives the one-time confirmation email: only first
      // activation, not renewals or plan changes (which would re-send an
      // "activated" email on every upgrade/downgrade).
      return {
        status: 'processed',
        userId,
        plan,
        activated: event.type === 'subscription.active',
      }
    }

    case 'subscription.failed': {
      // A failed charge is often transient (dunning / provider retry). Drop the
      // user to free, but KEEP subscription_id so a later recovery event that
      // lacks checkout metadata can still resolve them via resolveUserId. Only
      // terminal teardown (cancelled/expired) clears subscription_id. See adr/0005.
      const userId = await resolveUserId(db, data, subscriptionId)
      if (!userId) {
        console.warn(
          'dodo webhook: could not resolve user for payment failure',
          {
            type: event.type,
            subscriptionId,
          },
        )
        return { status: 'ignored' }
      }
      await db.query(
        `update users set tier = 'free', updated_at = now() where auth_user_id = $1`,
        [userId],
      )
      await logActivity(db, userId, 'tier.downgraded', {
        reason: event.type,
        subscriptionId,
      })
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
          where auth_user_id = $1`,
        [userId],
      )
      await logActivity(db, userId, 'tier.downgraded', {
        reason: event.type,
        subscriptionId,
      })
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
