import type { Bindings } from './env'
import type { PaidPlan } from './payments'

// Transactional email via Resend (raw fetch — no SDK). See docs/BACKEND.md.

// Resend's shared sandbox sender; override with RESEND_FROM in production.
const DEFAULT_FROM = 'Vibe Translate <onboarding@resend.dev>'

const PLAN_LABEL: Record<PaidPlan, string> = { pro: 'Pro', team: 'Team' }

export type EmailMessage = {
  env: Bindings
  to: string
  subject: string
  html: string
  text?: string
}

// Sends one transactional email. No-ops (with a warning) when RESEND_API_KEY is
// unset, so a missing email key never breaks a paid flow such as an upgrade.
// Throws only on an actual send failure, so non-critical callers can swallow it.
export async function sendTransactionalEmail(message: EmailMessage): Promise<void> {
  const apiKey = message.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.warn('sendTransactionalEmail: RESEND_API_KEY not set; skipping send', {
      to: message.to,
      subject: message.subject,
    })
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: message.env.RESEND_FROM?.trim() || DEFAULT_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Resend send failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
}

// Content for the subscription-activation confirmation email. Kept minimal on
// purpose — a richer template layer (e.g. react-email) can replace this later.
export function subscriptionConfirmationEmail(params: { plan: PaidPlan }): {
  subject: string
  html: string
  text: string
} {
  const label = PLAN_LABEL[params.plan]
  return {
    subject: `Your Vibe Translate ${label} plan is active`,
    html: `<p>You're on <strong>Vibe Translate ${label}</strong> now — your new monthly credits are ready.</p><p>Happy translating!</p>`,
    text: `You're on Vibe Translate ${label} now — your new monthly credits are ready. Happy translating!`,
  }
}
