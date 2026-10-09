import * as Dialog from '@radix-ui/react-dialog'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import { useMe } from '@/hooks/use-app-data'
import { keys } from '@/lib/query-keys'
import type { CreditRequirement } from '@/lib/api'

// Mounted at the authenticated shell so every paid action (including retry,
// Explain and dictation) has the same recovery path.
export function CreditRequiredModal() {
  const [open, setOpen] = React.useState(false)
  const [requirement, setRequirement] =
    React.useState<CreditRequirement | null>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const qc = useQueryClient()
  const me = useMe(open)
  React.useEffect(() => {
    const show = (event: Event) => {
      setRequirement(event instanceof CustomEvent ? event.detail : null)
      if (document.activeElement instanceof HTMLElement)
        returnFocus.current = document.activeElement
      setOpen(true)
      void qc.invalidateQueries({ queryKey: keys.me })
    }
    window.addEventListener('vibe:credits-required', show)
    return () => window.removeEventListener('vibe:credits-required', show)
  }, [qc])
  const balance = requirement?.balance ?? me.data?.credits.balance
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
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
            {balance !== undefined && balance > 0
              ? 'Your balance is too low to cover this request. Add credits or upgrade to keep going.'
              : 'Add credits for your next translation, or get a larger allowance with Pro.'}
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
          <div className="credit-modal__options">
            <div className="credit-modal__option">
              <span className="vt-eyebrow">MORE ROOM TO EXPLORE</span>
              <h3>Upgrade to Pro</h3>
              <p>More credits, grammar explanations and translation memory.</p>
              <Dialog.Close asChild>
                <Link className="vt-btn vt-btn--primary" to="/pricing">
                  Explore Pro <Icon name="arrow-right" />
                </Link>
              </Dialog.Close>
            </div>
            <div className="credit-modal__option">
              <span className="vt-eyebrow">JUST NEED A TOP-UP?</span>
              <h3>Add more credits</h3>
              <p>
                See your balance and usage, then buy credits with a one-time
                payment.
              </p>
              <Dialog.Close asChild>
                <Link className="vt-btn" to="/app/credits">
                  View credits &amp; top up <Icon name="arrow-right" />
                </Link>
              </Dialog.Close>
            </div>
          </div>
          <p className="credit-modal__note">
            Your text is still here. Close this window to return to it.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
