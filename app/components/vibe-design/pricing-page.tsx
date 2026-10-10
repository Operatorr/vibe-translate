import * as React from 'react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useSignedIn } from '@/lib/auth-client'
import { Icon } from './icon'
import { SiteNav } from './shell'
import { useVibeFrame, type NavigateFn } from './use-vibe-frame'

const PricingContent = ({ onNavigate }: { onNavigate: NavigateFn }) => {
  const [annual, setAnnual] = React.useState(true)
  const isSignedIn = useSignedIn()
  const [pendingPlan, setPendingPlan] = React.useState<'pro' | 'team' | null>(
    null,
  )

  const price = (m: number, y: number) => (annual ? `$${y}` : `$${m}`)

  // Pro → backend `pro`; Linguist → backend `team` (checkoutSchema plans).
  const startCheckout = async (plan: 'pro' | 'team') => {
    // Checkout requires an authenticated user — route guests through sign-in.
    if (!isSignedIn) {
      onNavigate('/app')
      return
    }
    setPendingPlan(plan)
    try {
      const { checkoutUrl } = await apiFetch<{ checkoutUrl: string }>(
        '/api/billing/checkout',
        {
          method: 'POST',
          body: JSON.stringify({
            plan,
            billingPeriod: annual ? 'annual' : 'monthly',
          }),
        },
      )
      window.location.assign(checkoutUrl)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not start checkout.',
      )
      setPendingPlan(null)
    }
  }

  return (
    <main className="site-main">
      <section className="pricing-hero">
        <div className="container">
          <span className="tag tag--accent">
            <span className="dot"></span> PRICING
          </span>
          <h1 className="pricing-hero__title">Pay for what you ship.</h1>
          <p className="pricing-hero__sub">
            Three plans. No seats trick, no per-language nickel-and-diming.
            Cancel any time. Annual saves 20%.
          </p>

          <div className="billing-toggle">
            <button
              className={'billing-toggle__opt ' + (!annual ? 'is-active' : '')}
              onClick={() => setAnnual(false)}
            >
              Monthly
            </button>
            <button
              className={'billing-toggle__opt ' + (annual ? 'is-active' : '')}
              onClick={() => setAnnual(true)}
            >
              Annual <span className="save">SAVE 20%</span>
            </button>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="tiers">
            {/* FREE */}
            <div className="tier">
              <h3 className="tier__name">Free</h3>
              <p className="tier__pitch">
                For language learners and the curious. Start on welcome credits,
                no bill.
              </p>
              <div className="tier__price">
                <span className="tier__price-num">$0</span>
                <span className="tier__price-unit">/ forever</span>
              </div>
              <div className="tier__price-meta">
                no credit card · 1,000 welcome credits
              </div>
              <button
                className="vt-btn vt-btn--ghost vt-btn--block"
                onClick={() => onNavigate('/app')}
              >
                Start free
              </button>
              <div className="tier__features">
                <div className="tier__features-h">INCLUDED</div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>1,000 credits</strong> to get started
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>3</strong> saved characters
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>All 38 languages</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>6-stop vibe slider</span>
                </div>
                <div className="tier__feat tier__feat--off">
                  <Icon name="x" />
                  <span>Inline Explain</span>
                </div>
                <div className="tier__feat tier__feat--off">
                  <Icon name="x" />
                  <span>API access</span>
                </div>
                <div className="tier__feat tier__feat--off">
                  <Icon name="x" />
                  <span>Translation memory</span>
                </div>
                <div className="tier__feat tier__feat--off">
                  <Icon name="x" />
                  <span>Zero-retention mode</span>
                </div>
              </div>
            </div>

            {/* PRO — featured */}
            <div className="tier tier--featured">
              <span className="tag tag--accent tier__tag">
                <span className="dot"></span> POPULAR
              </span>
              <h3 className="tier__name">Pro</h3>
              <p className="tier__pitch">
                For technical writers and devs shipping in 2+ languages. Unlocks
                the Explain panel.
              </p>
              <div className="tier__price">
                <span className="tier__price-num">{price(18, 14)}</span>
                <span className="tier__price-unit">/ month</span>
              </div>
              <div className="tier__price-meta">
                {annual
                  ? 'billed $168/yr · cancel any time'
                  : 'billed monthly · cancel any time'}
              </div>
              <button
                className="vt-btn vt-btn--primary vt-btn--block"
                onClick={() => startCheckout('pro')}
                disabled={pendingPlan !== null}
              >
                {pendingPlan === 'pro' ? 'Starting…' : 'Start 14-day trial'}
              </button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN FREE, PLUS</div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>25,000 credits</strong> per billing renewal
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>100</strong> saved characters
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Grammar explanations, charged from credits</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>API access, charged from credits</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Voice-to-text dictation</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Glossary pinning (beta)</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Zero-retention mode</span>
                </div>
                <div className="tier__feat tier__feat--off">
                  <Icon name="x" />
                  <span>Translation memory</span>
                </div>
              </div>
            </div>

            {/* LINGUIST */}
            <div className="tier">
              <h3 className="tier__name">Linguist</h3>
              <p className="tier__pitch">
                For localization shops and full-time translators. Premium model,
                every feature on.
              </p>
              <div className="tier__price">
                <span className="tier__price-num">{price(64, 49)}</span>
                <span className="tier__price-unit">/ month</span>
              </div>
              <div className="tier__price-meta">
                {annual
                  ? 'billed $588/yr · per individual'
                  : 'billed monthly · per individual'}
              </div>
              <button
                className="vt-btn vt-btn--ghost vt-btn--block"
                onClick={() => startCheckout('team')}
                disabled={pendingPlan !== null}
              >
                {pendingPlan === 'team' ? 'Starting…' : 'Start 14-day trial'}
              </button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN PRO, PLUS</div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>250,000 credits</strong> per billing renewal
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>1,000</strong> saved characters
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Premium model (Opus tier)</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Translation memory + bulk import</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>CAT-tool keyboard shortcuts</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>API webhooks</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>SSO · SAML / Google / GitHub</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Audit logs · 90 day retention</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Priority support · 4h SLA</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison matrix */}
      <section className="section section--tight">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow">
                <span className="tag">Compare</span>
              </div>
              <h2 className="section__title">Full feature comparison.</h2>
            </div>
            <p className="section__sub">
              No hidden upsells. If a feature isn't listed, it's available on
              every plan.
            </p>
          </div>

          <div
            className="matrix-scroll"
            role="region"
            aria-label="Full feature comparison"
            tabIndex={0}
          >
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix__feat-th">Feature</th>
                  <th>Free</th>
                  <th>Pro</th>
                  <th>Linguist</th>
                </tr>
              </thead>
              <tbody>
                <tr className="matrix__group-row">
                  <td colSpan={4}>USAGE</td>
                </tr>
                <tr>
                  <td>Credits</td>
                  <td>1,000 welcome</td>
                  <td>25,000 per renewal</td>
                  <td>250,000 per renewal</td>
                </tr>
                <tr>
                  <td>One-time credit top-ups</td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Saved characters</td>
                  <td>3</td>
                  <td>100</td>
                  <td>1,000</td>
                </tr>
                <tr>
                  <td>Languages</td>
                  <td>38</td>
                  <td>38</td>
                  <td>38</td>
                </tr>
                <tr>
                  <td>Vibe slider stops</td>
                  <td>6</td>
                  <td>6</td>
                  <td>6 + custom registers</td>
                </tr>

                <tr className="matrix__group-row">
                  <td colSpan={4}>QUALITY</td>
                </tr>
                <tr>
                  <td>Default model</td>
                  <td>vibe-translate-base</td>
                  <td>vibe-translate-base</td>
                  <td>vibe-translate-pro (Opus tier)</td>
                </tr>
                <tr>
                  <td>Streaming output</td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Temperature control</td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Inline Explain</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>Charged from credits</td>
                  <td>Charged from credits</td>
                </tr>

                <tr className="matrix__group-row">
                  <td colSpan={4}>WORKFLOW</td>
                </tr>
                <tr>
                  <td>Voice dictation</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Glossary pinning</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>Beta</td>
                  <td>GA</td>
                </tr>
                <tr>
                  <td>Translation memory</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>CAT keyboard shortcuts</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>Basic</td>
                  <td>Full</td>
                </tr>

                <tr className="matrix__group-row">
                  <td colSpan={4}>PLATFORM</td>
                </tr>
                <tr>
                  <td>API access</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>Charged from credits</td>
                  <td>Charged from credits</td>
                </tr>
                <tr>
                  <td>CLI (npx vibe-translate)</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Webhooks</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>

                <tr className="matrix__group-row">
                  <td colSpan={4}>SECURITY &amp; SUPPORT</td>
                </tr>
                <tr>
                  <td>Zero-retention mode</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>SSO (SAML, Google, GitHub)</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="check" className="matrix__check" />
                  </td>
                </tr>
                <tr>
                  <td>Audit logs</td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>
                    <Icon name="minus" className="matrix__dash" />
                  </td>
                  <td>90 days</td>
                </tr>
                <tr>
                  <td>Support SLA</td>
                  <td>Community</td>
                  <td>48h email</td>
                  <td>4h priority</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow">
                <span className="tag">Pricing FAQ</span>
              </div>
              <h2 className="section__title">Billing answered briefly.</h2>
            </div>
            <p className="section__sub">
              If your question isn't here, ping support — we read every email.
            </p>
          </div>

          <div className="faq">
            <div className="faq__item faq__item--open">
              <h3 className="faq__q">
                How are credits calculated?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Each request uses the model’s actual prompt and completion token
                counts, multiplied by its credit rate and rounded up. The prompt
                includes your character settings. Saved and cached translations
                are free, and using your own OpenRouter key skips credits for
                translations and explanations.
              </p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">
                Can I switch plans mid-month?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Yes. Upgrades are prorated. Downgrades take effect at the end of
                the current period. No fees.
              </p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">
                Do you have team plans?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                A team plan is in private beta — shared characters, shared
                glossary, centralized billing, role-based access. Email
                founders@marrow.tech to be added.
              </p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">
                What if I run out of credits on Pro?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Open Profile &amp; credits to see your balance and recent usage.
                You can buy a one-time credit pack through Dodo Payments or use
                your own OpenRouter key. Your saved translations remain
                available when your credits run out.
              </p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">
                Is there a student / open-source discount?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Yes — students get Pro for $7/mo with a .edu address. OSS
                maintainers with 500+ stars get Pro free. Apply via the docs.
              </p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">
                What happens to my data if I cancel?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Threads stay readable for 30 days, then are deleted.
                Export-as-JSON is one click and works on every plan including
                Free.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA reuse */}
      <section className="cta-strip">
        <div className="cta-strip__halo"></div>
        <div className="cta-strip__inner">
          <span className="tag tag--accent">
            <span className="dot"></span> READY WHEN YOU ARE
          </span>
          <h2 className="cta-strip__title">Try it before you pay for it.</h2>
          <p className="cta-strip__sub">
            Free tier is genuinely free. Pro and Linguist start with 14 days, no
            card.
          </p>
          <div className="hero__ctas">
            <button
              className="vt-btn vt-btn--primary vt-btn--lg"
              onClick={() => onNavigate('/app')}
            >
              Open the app
            </button>
            <button
              className="vt-btn vt-btn--ghost vt-btn--lg"
              onClick={() => onNavigate('/')}
            >
              Back to overview
            </button>
          </div>
        </div>
      </section>

      {/* Footer reuse — minimal version */}
      <footer className="footer">
        <div className="container">
          <div className="footer__bot" style={{ borderTop: 0, paddingTop: 0 }}>
            <span>© 2026 Marrow Tech, Inc. · Vibe Translate</span>
            <span style={{ display: 'flex', gap: 24 }}>
              <a
                href="#/"
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate('/')
                }}
              >
                Product
              </a>
              <a href="#" onClick={(e) => e.preventDefault()}>
                Docs
              </a>
              <a href="#" onClick={(e) => e.preventDefault()}>
                Status
              </a>
              <a href="#" onClick={(e) => e.preventDefault()}>
                Privacy
              </a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  )
}

export function VibePricingPage() {
  const frame = useVibeFrame('/pricing')

  return (
    <div className="site">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/pricing"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
      />
      <PricingContent onNavigate={frame.onNavigate} />
    </div>
  )
}
