import * as Dialog from '@radix-ui/react-dialog'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import { useMe } from '@/hooks/use-app-data'
import { keys } from '@/lib/query-keys'
import type { CreditRequirement } from '@/lib/api'
import type { UserTier } from '@/lib/types'

type Upgrade = {
  eyebrow: string
  title: string
  body: string
  cta: string
  // Completes "get a larger allowance with …".
  plan: string
}

// The upgrade option follows the plan. `team` is shown as Linguist, the
// largest plan, so it has none; `unknown` covers `me` still loading.
const UPGRADES: Record<UserTier | 'unknown', Upgrade | null> = {
  free: {
    eyebrow: 'MORE ROOM TO EXPLORE',
    title: 'Upgrade to Pro',
    body: '25,000 credits every renewal, up from the one-time 1,000 welcome credits.',
    cta: 'Explore Pro',
    plan: 'Pro',
  },
  pro: {
    eyebrow: 'NEED A BIGGER ALLOWANCE?',
    title: 'Upgrade to Linguist',
    body: '250,000 credits every renewal, ten times Pro’s allowance.',
    cta: 'Explore Linguist',
    plan: 'Linguist',
  },
  team: null,
  unknown: {
    eyebrow: 'MORE ROOM TO EXPLORE',
    title: 'Get a larger allowance',
    body: 'Paid plans renew their credits every billing period.',
    cta: 'Compare plans',
    plan: 'a larger plan',
  },
}

// Mounted at the authenticated shell so every paid action (including retry,
// Explain and dictation) has the same recovery path. It opens asynchronously
// over whatever is on screen, so its CSS layer sits above every other overlay.
export function CreditRequiredModal() {
  const [open, setOpen] = React.useState(false)
  // Synchronous mirror of `open`: a second 402 while open (or before React
  // re-renders) must not replace the focus target with the dialog itself.
  const openRef = React.useRef(false)
  const [requirement, setRequirement] =
    React.useState<CreditRequirement | null>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const qc = useQueryClient()
  const me = useMe(open)
  React.useEffect(() => {
    const show = (event: Event) => {
      setRequirement(event instanceof CustomEvent ? event.detail : null)
      if (!openRef.current) {
        openRef.current = true
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      }
      setOpen(true)
      void qc.invalidateQueries({ queryKey: keys.me })
    }
    window.addEventListener('vibe:credits-required', show)
    return () => window.removeEventListener('vibe:credits-required', show)
  }, [qc])
  const onOpenChange = (next: boolean) => {
    openRef.current = next
    setOpen(next)
  }
  const balance = requirement?.balance ?? me.data?.credits.balance
  const upgrade = UPGRADES[me.data?.tier ?? 'unknown']
  const description =
    balance !== undefined && balance > 0
      ? `Your balance is too low to cover this request. Add credits${upgrade ? ' or upgrade' : ''} to keep going.`
      : `Add credits for your next translation${upgrade ? `, or get a larger allowance with ${upgrade.plan}` : ''}.`
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="credit-modal__overlay" />
        <Dialog.Content
          className="credit-modal"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus()
          }}
        >
          <Dialog.Close asChild>
            <button
              type="button"
              className="credit-modal__close"
              aria-label="Close credits dialog"
            >
              <Icon name="x" />
            </button>
          </Dialog.Close>
          <span className="vt-eyebrow">KEEP TRANSLATING</span>
          <Dialog.Title className="credit-modal__title">
            {balance !== undefined && balance <= 0
              ? 'You’re out of credits.'
              : 'You need more credits.'}
          </Dialog.Title>
          <Dialog.Description className="credit-modal__description">
            {description}
          </Dialog.Description>
          {balance !== undefined && (
            <p className="credit-modal__balance">
              {balance.toLocaleString()} credits remaining
            </p>
          )}
          {requirement && (
            <p className="credit-modal__note">
              {requirement.requiredCredits.toLocaleString()} credits needed to
              start this request. This is a temporary reservation. The final
              charge uses the actual input and output tokens; unused reserved
              credits are returned.
            </p>
          )}
          {!upgrade && (
            <p className="credit-modal__note">
              You’re on Linguist, our largest plan, so a top-up is the way to
              keep going.
            </p>
          )}
          <div className="credit-modal__options">
            {upgrade && (
              <div className="credit-modal__option">
                <span className="vt-eyebrow">{upgrade.eyebrow}</span>
                <h3>{upgrade.title}</h3>
                <p>{upgrade.body}</p>
                <Dialog.Close asChild>
                  <Link className="vt-btn vt-btn--primary" to="/pricing">
                    {upgrade.cta} <Icon name="arrow-right" />
                  </Link>
                </Dialog.Close>
              </div>
            )}
            <div className="credit-modal__option">
              <span className="vt-eyebrow">JUST NEED A TOP-UP?</span>
              <h3>Add more credits</h3>
              <p>
                See your balance and usage, then buy credits with a one-time
                payment.
              </p>
              <Dialog.Close asChild>
                <Link
                  className={upgrade ? 'vt-btn' : 'vt-btn vt-btn--primary'}
                  to="/app/credits"
                >
                  View credits &amp; top up <Icon name="arrow-right" />
                </Link>
              </Dialog.Close>
            </div>
          </div>
          <p className="credit-modal__note">
            Your draft is saved. It will be waiting when you come back.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
