// Pricing.jsx — Pricing page (3 tiers + comparison matrix + FAQ + footer reuse)

const Pricing = ({ onNavigate }) => {
  const [annual, setAnnual] = React.useState(true);

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });

  const price = (m, y) => annual ? `$${y}` : `$${m}`;

  return (
    <main className="site-main">
      <section className="pricing-hero">
        <div className="container">
          <span className="tag tag--accent"><span className="dot"></span> PRICING</span>
          <h1 className="pricing-hero__title">Pay for what you ship.</h1>
          <p className="pricing-hero__sub">Three plans. No seats trick, no per-language nickel-and-diming. Cancel any time. Annual saves 20%.</p>

          <div className="billing-toggle">
            <button className={"billing-toggle__opt " + (!annual ? 'is-active' : '')} onClick={() => setAnnual(false)}>Monthly</button>
            <button className={"billing-toggle__opt " + (annual ? 'is-active' : '')} onClick={() => setAnnual(true)}>
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
              <p className="tier__pitch">For language learners and the curious. Daily-driver translator without the bill.</p>
              <div className="tier__price">
                <span className="tier__price-num">$0</span>
                <span className="tier__price-unit">/ forever</span>
              </div>
              <div className="tier__price-meta">no credit card · 10k tokens / day</div>
              <button className="vt-btn vt-btn--ghost vt-btn--block" onClick={() => onNavigate('/app')}>Start free</button>
              <div className="tier__features">
                <div className="tier__features-h">INCLUDED</div>
                <div className="tier__feat"><i data-lucide="check"></i><span><strong>10k tokens</strong> per day</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span><strong>3</strong> saved characters</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>All 38 languages</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>6-stop vibe slider</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Inline Explain (limited to 20 / day)</span></div>
                <div className="tier__feat tier__feat--off"><i data-lucide="x"></i><span>API access</span></div>
                <div className="tier__feat tier__feat--off"><i data-lucide="x"></i><span>Translation memory</span></div>
                <div className="tier__feat tier__feat--off"><i data-lucide="x"></i><span>Zero-retention mode</span></div>
              </div>
            </div>

            {/* PRO — featured */}
            <div className="tier tier--featured">
              <span className="tag tag--accent tier__tag"><span className="dot"></span> POPULAR</span>
              <h3 className="tier__name">Pro</h3>
              <p className="tier__pitch">For technical writers and devs shipping in 2+ languages. The Explain panel comes off the leash.</p>
              <div className="tier__price">
                <span className="tier__price-num">{price(18, 14)}</span>
                <span className="tier__price-unit">/ month</span>
              </div>
              <div className="tier__price-meta">{annual ? 'billed $168/yr · cancel any time' : 'billed monthly · cancel any time'}</div>
              <button className="vt-btn vt-btn--primary vt-btn--block" onClick={() => onNavigate('/app')}>Start 14-day trial</button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN FREE, PLUS</div>
                <div className="tier__feat"><i data-lucide="check"></i><span><strong>1M tokens</strong> per month</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span><strong>Unlimited</strong> saved characters</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Unlimited Explain panels</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>API access · 100k tok/mo</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Voice-to-text dictation</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Glossary pinning (beta)</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Zero-retention mode</span></div>
                <div className="tier__feat tier__feat--off"><i data-lucide="x"></i><span>Translation memory</span></div>
              </div>
            </div>

            {/* LINGUIST */}
            <div className="tier">
              <h3 className="tier__name">Linguist</h3>
              <p className="tier__pitch">For localization shops and full-time translators. Unmetered, premium model, every feature on.</p>
              <div className="tier__price">
                <span className="tier__price-num">{price(64, 49)}</span>
                <span className="tier__price-unit">/ month</span>
              </div>
              <div className="tier__price-meta">{annual ? 'billed $588/yr · per individual' : 'billed monthly · per individual'}</div>
              <button className="vt-btn vt-btn--ghost vt-btn--block" onClick={() => onNavigate('/app')}>Start 14-day trial</button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN PRO, PLUS</div>
                <div className="tier__feat"><i data-lucide="check"></i><span><strong>Unmetered</strong> tokens</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Premium model (Opus tier)</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Translation memory + bulk import</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>CAT-tool keyboard shortcuts</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>API · unmetered for individual use</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>SSO · SAML / Google / GitHub</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Audit logs · 90 day retention</span></div>
                <div className="tier__feat"><i data-lucide="check"></i><span>Priority support · 4h SLA</span></div>
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
              <div className="section__eyebrow"><span className="tag">Compare</span></div>
              <h2 className="section__title">Full feature comparison.</h2>
            </div>
            <p className="section__sub">No hidden upsells. If a feature isn't listed, it's available on every plan.</p>
          </div>

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
              <tr className="matrix__group-row"><td colSpan="4">USAGE</td></tr>
              <tr><td>Daily token quota</td><td>10k</td><td>33k (1M / mo)</td><td>Unmetered</td></tr>
              <tr><td>Saved characters</td><td>3</td><td>Unlimited</td><td>Unlimited</td></tr>
              <tr><td>Languages</td><td>38</td><td>38</td><td>38</td></tr>
              <tr><td>Vibe slider stops</td><td>6</td><td>6</td><td>6 + custom registers</td></tr>

              <tr className="matrix__group-row"><td colSpan="4">QUALITY</td></tr>
              <tr><td>Default model</td><td>vibe-translate-base</td><td>vibe-translate-base</td><td>vibe-translate-pro (Opus tier)</td></tr>
              <tr><td>Streaming output</td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>Temperature control</td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>Inline Explain</td><td>20 / day</td><td>Unlimited</td><td>Unlimited</td></tr>

              <tr className="matrix__group-row"><td colSpan="4">WORKFLOW</td></tr>
              <tr><td>Voice dictation</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>Glossary pinning</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td>Beta</td><td>GA</td></tr>
              <tr><td>Translation memory</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>CAT keyboard shortcuts</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td>Basic</td><td>Full</td></tr>

              <tr className="matrix__group-row"><td colSpan="4">PLATFORM</td></tr>
              <tr><td>API access</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td>100k tok / mo</td><td>Unmetered</td></tr>
              <tr><td>CLI (npx vibe-translate)</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>Webhooks</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>

              <tr className="matrix__group-row"><td colSpan="4">SECURITY &amp; SUPPORT</td></tr>
              <tr><td>Zero-retention mode</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>SSO (SAML, Google, GitHub)</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__check" data-lucide="check"></i></td></tr>
              <tr><td>Audit logs</td><td><i className="matrix__dash" data-lucide="minus"></i></td><td><i className="matrix__dash" data-lucide="minus"></i></td><td>90 days</td></tr>
              <tr><td>Support SLA</td><td>Community</td><td>48h email</td><td>4h priority</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow"><span className="tag">Pricing FAQ</span></div>
              <h2 className="section__title">Billing answered briefly.</h2>
            </div>
            <p className="section__sub">If your question isn't here, ping support — we read every email.</p>
          </div>

          <div className="faq">
            <div className="faq__item faq__item--open">
              <h3 className="faq__q">What counts as a token?<i data-lucide="plus"></i></h3>
              <p className="faq__a">Roughly 0.75 words for Latin-script languages. For CJK, one token ≈ one character. Both source and target tokens count toward your quota. The composer shows a live token estimate as you type.</p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">Can I switch plans mid-month?<i data-lucide="plus"></i></h3>
              <p className="faq__a">Yes. Upgrades are prorated. Downgrades take effect at the end of the current period. No fees.</p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">Do you have team plans?<i data-lucide="plus"></i></h3>
              <p className="faq__a">A team plan is in private beta — shared characters, shared glossary, centralized billing, role-based access. Email founders@marrow.tech to be added.</p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">What if I run out of tokens on Pro?<i data-lucide="plus"></i></h3>
              <p className="faq__a">You'll get an email at 80% and 100%. Past 100% you can either wait until the next period (the app falls back to read-only on saved threads) or top up at $0.01 per 1k tokens.</p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">Is there a student / open-source discount?<i data-lucide="plus"></i></h3>
              <p className="faq__a">Yes — students get Pro for $7/mo with a .edu address. OSS maintainers with 500+ stars get Pro free. Apply via the docs.</p>
            </div>
            <div className="faq__item">
              <h3 className="faq__q">What happens to my data if I cancel?<i data-lucide="plus"></i></h3>
              <p className="faq__a">Threads stay readable for 30 days, then are deleted. Export-as-JSON is one click and works on every plan including Free.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA reuse */}
      <section className="cta-strip">
        <div className="cta-strip__halo"></div>
        <div className="cta-strip__inner">
          <span className="tag tag--accent"><span className="dot"></span> READY WHEN YOU ARE</span>
          <h2 className="cta-strip__title">Try it before you pay for it.</h2>
          <p className="cta-strip__sub">Free tier is genuinely free. Pro and Linguist start with 14 days, no card.</p>
          <div className="hero__ctas">
            <button className="vt-btn vt-btn--primary vt-btn--lg" onClick={() => onNavigate('/app')}>Open the app</button>
            <button className="vt-btn vt-btn--ghost vt-btn--lg" onClick={() => onNavigate('/')}>Back to overview</button>
          </div>
        </div>
      </section>

      {/* Footer reuse — minimal version */}
      <footer className="footer">
        <div className="container">
          <div className="footer__bot" style={{borderTop: 0, paddingTop: 0}}>
            <span>© 2026 Marrow Tech, Inc. · Vibe Translate</span>
            <span style={{display:'flex',gap:24}}>
              <a href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>Product</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Docs</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Status</a>
              <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
};
window.Pricing = Pricing;
