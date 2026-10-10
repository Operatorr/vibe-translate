import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { AccountMenu } from '@/components/app/account-menu'
import { CommandPalette, SiteNav } from '@/components/vibe-design/shell'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import { apiFetch } from '@/lib/api'
import { useSignedIn } from '@/lib/auth-client'
import { keys } from '@/lib/query-keys'
import type { Me } from '@/lib/types'

// A checkout return polls its order this long before offering "Check payment".
export const PAYMENT_POLL_TIMEOUT_MS = 60_000
export const PAYMENT_POLL_INTERVAL_MS = 2000

type CreditHistory = {
  me: Me
  packs: Array<{
    id: 'small' | 'medium' | 'large'
    credits: number
    available: boolean
    price: { amount: number; currency: string } | null
  }>
  order: { credits: number; fulfilled: boolean } | null
  ledger: Array<{
    id: string
    delta: number
    reason: string
    pending: boolean
    createdAt: string
  }>
}
const REASONS: Record<string, string> = {
  'grant.signup': 'Welcome credits',
  'grant.monthly': 'Allowance added',
  'grant.subscription': 'Subscription credits',
  'grant.adjustment': 'Credit adjustment',
  'grant.purchase': 'Credit top-up',
  'reversal.purchase': 'Top-up reversed',
  'spend.translate': 'Translation',
  'spend.explain': 'Grammar explanation',
  'spend.dictation': 'Character dictation',
}

// `/app/credits` body; the route validates `?orderId=` and passes it in.
export function CreditsPage({ orderId }: { orderId?: string }) {
  const frame = useVibeFrame('/app')
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const [packId, setPackId] = React.useState('small')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pollStarted, setPollStarted] = React.useState(Date.now)
  // Each order gets its own polling window, even without a remount.
  React.useEffect(() => setPollStarted(Date.now()), [orderId])
  const history = useQuery({
    queryKey: keys.credits(orderId ?? null),
    queryFn: ({ signal }) =>
      apiFetch<CreditHistory>(
        `/api/users/me/credits${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`,
        { signal },
      ),
    enabled: signedIn === true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      orderId &&
      query.state.data?.order?.fulfilled === false &&
      Date.now() - pollStarted < PAYMENT_POLL_TIMEOUT_MS
        ? PAYMENT_POLL_INTERVAL_MS
        : false,
  })
  const { data, dataUpdatedAt } = history
  const selectedPack =
    data?.packs.find((pack) => pack.id === packId && pack.available) ??
    data?.packs.find((pack) => pack.available) ??
    data?.packs[0]
  // Every fresh response carries the account, so the workspace balance follows
  // "Refresh balance" and order fulfillment. A remount's cached history must
  // not overwrite a newer account read.
  React.useEffect(() => {
    if (!data) return
    if (dataUpdatedAt <= (qc.getQueryState(keys.me)?.dataUpdatedAt ?? 0)) return
    qc.setQueryData(keys.me, data.me, { updatedAt: dataUpdatedAt })
  }, [data, dataUpdatedAt, qc])
  // Back from Dodo restores this page from the BFCache mid-checkout.
  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setBusy(false)
      setError(null)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const checkout = async () => {
    if (!selectedPack?.available || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiFetch<{ checkoutUrl: string }>(
        '/api/billing/credits/checkout',
        {
          method: 'POST',
          body: JSON.stringify({ pack: selectedPack.id }),
        },
      )
      window.location.assign(result.checkoutUrl)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not start checkout. Please try again.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="vt-page credits-page">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/app"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
        account={<AccountMenu />}
      />
      <main className="credits-page__main">
        <Link className="credits-page__back" to="/app">
          ← Back to translations
        </Link>
        <header className="credits-page__head">
          <span className="vt-eyebrow">PROFILE &amp; CREDITS</span>
          <h1>Your credits.</h1>
          <p>{data?.me.displayName || data?.me.email || 'Your account'}</p>
        </header>
        {history.isPending && <p role="status">Loading your credits…</p>}
        {history.isError && (
          <div className="credits-page__notice" role="alert">
            <p>{history.error.message}</p>
            <button className="vt-btn" onClick={() => void history.refetch()}>
              Try again
            </button>
          </div>
        )}
        {data && (
          <>
            {data.order && (
              <div className="credits-page__notice" role="status">
                {data.order.fulfilled
                  ? `${data.order.credits.toLocaleString()} credits added. You’re ready to translate.`
                  : 'Waiting for payment confirmation. Credits are added once your payment is verified.'}
                {!data.order.fulfilled && (
                  <button
                    className="vt-btn"
                    onClick={() => {
                      setPollStarted(Date.now())
                      void history.refetch()
                    }}
                  >
                    Check payment
                  </button>
                )}
              </div>
            )}
            <section
              className="credits-page__balance"
              aria-label="Credit balance"
            >
              <div>
                <span className="vt-eyebrow">AVAILABLE BALANCE</span>
                <p className="credits-page__amount">
                  {data.me.credits.balance.toLocaleString()}{' '}
                  <span>credits</span>
                </p>
                <p>
                  Credits are charged from actual model token usage. Saved and
                  cached translations are free.
                </p>
                {data.me.byok.configured && (
                  <p>
                    Your OpenRouter key is connected. Translations and
                    explanations use your key without spending credits.
                  </p>
                )}
              </div>
              <div className="credits-page__plan">
                <span className="vt-eyebrow">
                  {data.me.tier === 'team'
                    ? 'LINGUIST'
                    : data.me.tier.toUpperCase()}{' '}
                  ACCOUNT
                </span>
                <p>
                  {data.me.limits.credits.toLocaleString()} credits in your plan
                  allowance.
                </p>
                {data.me.tier === 'free' && (
                  <Link className="vt-btn vt-btn--primary" to="/pricing">
                    Upgrade to Pro →
                  </Link>
                )}
              </div>
            </section>
            <section
              className="credits-page__topup"
              aria-labelledby="topup-title"
            >
              <div>
                <span className="vt-eyebrow">ONE-TIME TOP-UP</span>
                <h2 id="topup-title">A little more room.</h2>
                <p>
                  Add credits to your current account. No subscription change.
                </p>
              </div>
              <div className="credits-page__purchase">
                <fieldset className="credits-page__packs" disabled={busy}>
                  <legend>Choose your top-up</legend>
                  {data.packs.map((pack) => (
                    <label className="credits-page__pack" key={pack.id}>
                      <input
                        type="radio"
                        name="credit-pack"
                        value={pack.id}
                        checked={selectedPack?.id === pack.id}
                        disabled={!pack.available}
                        onChange={() => setPackId(pack.id)}
                      />
                      <span>
                        <strong>{pack.credits.toLocaleString()} credits</strong>
                        <small>
                          {pack.id === 'small'
                            ? 'Quick top-up'
                            : pack.id === 'medium'
                              ? 'Keep going'
                              : 'Stock up'}
                        </small>
                      </span>
                      <span>
                        {pack.price ? formatPrice(pack.price) : 'Unavailable'}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p>
                  Base prices from Dodo. Final currency and any taxes are shown
                  at checkout before you pay.
                </p>
                <button
                  type="button"
                  className="vt-btn vt-btn--primary"
                  disabled={busy || !selectedPack?.available}
                  onClick={() => void checkout()}
                >
                  {busy ? 'Opening checkout…' : 'Buy credits →'}
                </button>
                {!data.packs.some((pack) => pack.available) && (
                  <p role="status">
                    Credit top-ups are currently unavailable. Try refreshing or
                    come back later.
                  </p>
                )}
                {error && <p role="alert">{error}</p>}
              </div>
            </section>
            <section
              className="credits-page__history"
              aria-labelledby="history-title"
            >
              <div className="credits-page__history-head">
                <h2 id="history-title">Recent activity</h2>
                <button
                  className="vt-btn"
                  disabled={history.isFetching}
                  onClick={() => void history.refetch()}
                >
                  {history.isFetching ? 'Refreshing…' : 'Refresh balance'}
                </button>
              </div>
              <p>
                Your latest 50 grants and charges. Pending amounts are temporary
                holds and settle after the request.
              </p>
              {!data.ledger.length ? (
                <p>No credit activity yet.</p>
              ) : (
                <ul className="credits-page__ledger">
                  {data.ledger.map((entry) => (
                    <li key={entry.id}>
                      <div>
                        <strong>
                          {REASONS[entry.reason] ?? 'Credit activity'}
                          {entry.pending ? ' · pending' : ''}
                        </strong>
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </time>
                      </div>
                      <span className={entry.delta > 0 ? 'is-credit' : ''}>
                        {entry.delta > 0 ? '+' : ''}
                        {entry.delta.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      {frame.paletteOpen && (
        <CommandPalette
          open={frame.paletteOpen}
          onClose={() => frame.setPaletteOpen(false)}
          items={[
            { id: 'app', label: 'Back to translations', icon: 'languages' },
            { id: 'pricing', label: 'Explore plans', icon: 'arrow-right' },
            { id: 'theme', label: 'Toggle theme', icon: 'sun-moon' },
          ]}
          onPick={(id) => {
            if (id === 'theme') frame.onToggleTheme()
            else frame.onNavigate(id === 'pricing' ? '/pricing' : '/app')
          }}
        />
      )}
    </div>
  )
}

function formatPrice(price: { amount: number; currency: string }) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: price.currency,
  })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(price.amount / 10 ** digits)
}
