// Landing.jsx — landing page (hero + demo + how it works + features + vibe-show + FAQ + CTA + footer)

const LandingDemo = () => {
  const [text, setText] = React.useState("Could you write down your recipe so I don't forget?");
  const [vibeIdx, setVibeIdx] = React.useState(3); // keigo
  const [out, setOut] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const vibes = window.VIBE_PRESETS_PER_LANG['ja-JP'];
  const activeVibe = vibes[vibeIdx];
  const target = window.DEMO_PAIRS_JA[activeVibe.id] || '...';

  const run = () => {
    if (busy) return;
    setBusy(true);
    setOut('');
    let i = 0;
    const tick = () => {
      if (i <= target.length) {
        setOut(target.slice(0, i));
        i += Math.max(1, Math.round(target.length / 40));
        setTimeout(tick, 28);
      } else {
        setOut(target);
        setBusy(false);
      }
    };
    tick();
  };

  React.useEffect(() => { run(); /* eslint-disable-next-line */ }, [vibeIdx]);

  return (
    <section className="demo">
      <div className="container">
        <div className="demo__frame">
          <div className="demo__bar">
            <div className="demo__bar-left">
              <div className="demo__bar-dots">
                <span className="demo__bar-dot" style={{background:'var(--red-400)'}}></span>
                <span className="demo__bar-dot" style={{background:'var(--amber-400)'}}></span>
                <span className="demo__bar-dot" style={{background:'var(--turq-400)'}}></span>
              </div>
              <span>vibe-translate · live demo</span>
            </div>
            <div className="demo__bar-right">
              <span style={{color:'var(--turq-400)'}}>● online</span>
              <span>vibe-translate-v0.42</span>
            </div>
          </div>

          <div className="demo__heads">
            <div className="demo__head-cell">
              <span className="demo__head-flag">🇺🇸</span>
              <div className="demo__head-body">
                <span className="demo__head-eyebrow">FROM</span>
                <span className="demo__head-lang">English (US)</span>
              </div>
            </div>
            <div className="demo__head-cell demo__head-cell--center">
              <button className="demo__swap-inline" aria-label="Swap"><i data-lucide="arrow-left-right"></i></button>
            </div>
            <div className="demo__head-cell">
              <span className="demo__head-flag">🇯🇵</span>
              <div className="demo__head-body">
                <span className="demo__head-eyebrow">TO · {activeVibe.label.toUpperCase()}</span>
                <span className="demo__head-lang">Japanese · 日本語</span>
              </div>
            </div>
          </div>

          <div className="demo__panes">
            <div className="demo__pane">
              <textarea
                className="demo__textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type something to translate..."
              />
            </div>
            <div className="demo__divider"></div>
            <div className="demo__pane">
              <div className="demo__output" style={{fontSize: 22, lineHeight: 1.6}}>
                {out || <span className="demo__output--empty">Output streams here.</span>}
                {busy && <span className="vt-cursor"></span>}
              </div>
            </div>
          </div>

          <div className="demo__ctrls">
            <div className="demo__vibe">
              <div className="vibe-mini__head">
                <span className="vibe-mini__head-l">VIBE · 6 stops</span>
                <span className="vibe-mini__head-r" style={{color: activeVibe.color}}>
                  {activeVibe.label} · {activeVibe.hint}
                </span>
              </div>
              <div className="vibe-mini__rail-wrap">
                <div className="vibe-mini__rail"></div>
                <div className="vibe-mini__fill" style={{width: `${(vibeIdx/(vibes.length-1))*100}%`, background: activeVibe.color}}></div>
                <div className="vibe-mini__stops">
                  {vibes.map((v, i) => (
                    <button
                      key={v.id}
                      className={"vibe-mini__dot " + (i === vibeIdx ? 'is-active' : '')}
                      style={{left: `${(i/(vibes.length-1))*100}%`, '--vibe-fill': v.color}}
                      onClick={() => setVibeIdx(i)}
                      aria-label={v.label}
                    ></button>
                  ))}
                </div>
              </div>
              <div className="vibe-mini__labels">
                {vibes.map((v, i) => (
                  <span key={v.id} className={"vibe-mini__label " + (i === vibeIdx ? 'is-active' : '')} onClick={() => setVibeIdx(i)} style={{color: i === vibeIdx ? v.color : undefined}}>{v.label}</span>
                ))}
              </div>
            </div>
            <div style={{font:'400 11px/1 var(--font-mono)',color:'var(--fg-subtle)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
              ⌘ ↵ to run
            </div>
            <button className={"vt-btn vt-btn--primary " + (busy ? 'is-busy' : '')} onClick={run} disabled={busy || !text.trim()}>
              {busy ? <><i data-lucide="loader"></i> Translating</> : <>Translate <kbd>↵</kbd></>}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

const FAQItem = ({ q, a, defaultOpen }) => {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div className={"faq__item " + (open ? 'faq__item--open' : '')} onClick={() => setOpen(o => !o)}>
      <h3 className="faq__q">{q}<i data-lucide="plus"></i></h3>
      <p className="faq__a">{a}</p>
    </div>
  );
};

const Landing = ({ onNavigate }) => {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });

  return (
    <main className="site-main">
      {/* HERO */}
      <section className="hero">
        <div className="hero__halo"></div>
        <div className="container">
          <div className="hero__content">
            <div className="hero__eyebrow"><span className="tag tag--accent"><span className="dot"></span> v0.42 · Japanese keigo levels now respected</span></div>
            <h1 className="hero__title">Translate the <em>vibe</em>,<br/>not just the words.</h1>
            <p className="hero__sub">A translation engine for developers, technical writers, and anyone who has to ship in more than one language. Pick a tone. Pick a target. Translate intent, not strings.</p>
            <div className="hero__ctas">
              <button className="vt-btn vt-btn--primary vt-btn--lg" onClick={() => onNavigate('/app')}>
                Start translating <kbd>↵</kbd>
              </button>
              <button className="vt-btn vt-btn--ghost vt-btn--lg" onClick={() => onNavigate('/pricing')}>Read the docs <i data-lucide="arrow-up-right"></i></button>
            </div>

            <div className="hero__bench">
              <div className="hero__bench-item">
                <span className="hero__bench-num">38</span>
                <span>languages</span>
              </div>
              <div className="hero__bench-item">
                <span className="hero__bench-num">6</span>
                <span>vibe stops</span>
              </div>
              <div className="hero__bench-item">
                <span className="hero__bench-num">0.42</span>
                <span>current build</span>
              </div>
              <div className="hero__bench-item">
                <span className="hero__bench-num">12k</span>
                <span>tokens / second</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <LandingDemo />

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow"><span className="tag">How it works</span></div>
              <h2 className="section__title">Four steps. Zero translation memory baggage.</h2>
            </div>
            <p className="section__sub">No glossary upload. No pre-training. Drop a character config, pick a vibe, hit translate. Everything else — register, dialect, register-aware honorifics — is inferred.</p>
          </div>

          <div className="steps">
            <div className="step">
              <div className="step__num">01 / DEFINE</div>
              <h3 className="step__title">Build a character</h3>
              <p className="step__body">Age, region, formality, traits. The character becomes the system prompt — once, not every message.</p>
              <div className="step__visual">
                <div><span className="c">// character.toml</span></div>
                <div><span className="k">name</span> = <span className="v">"Oba-chan"</span></div>
                <div><span className="k">target</span> = <span className="v">"ja-JP"</span></div>
                <div><span className="k">region</span> = <span className="v">"Osaka"</span></div>
                <div><span className="k">vibe</span> = <span className="v">"casual"</span></div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">02 / DIAL</div>
              <h3 className="step__title">Pick a vibe</h3>
              <p className="step__body">6 stops per target. JP runs Yakuza → Friend → Casual → Keigo → Keigo+ → Emperor. KR has banmal/jondaemal. Etc.</p>
              <div className="step__visual">
                <div><span className="c">vibe = casual</span></div>
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  {window.VIBE_PRESETS_PER_LANG['ja-JP'].map((v, i) => (
                    <span key={v.id} style={{height: 14, width: 14, background: i === 2 ? v.color : 'transparent', border: '1px solid ' + v.color, borderRadius: '50%'}}></span>
                  ))}
                </div>
                <div><span className="c">// inferred</span> <span className="v">"です/ます"</span></div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">03 / RUN</div>
              <h3 className="step__title">Translate</h3>
              <p className="step__body">Streaming token-by-token. Cmd-↵ to run. Source on the left, target on the right, like a CAT tool — not a chat wrapper.</p>
              <div className="step__visual">
                <div><span className="c">{">> input"}</span></div>
                <div>"come over for dinner"</div>
                <div><span className="c">{">> output"}</span></div>
                <div style={{color:'var(--turq-400)'}}>"晩ご飯食べに来てや"</div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">04 / LEARN</div>
              <h3 className="step__title">Explain &amp; ship</h3>
              <p className="step__body">Hit “Explain” for word-by-word breakdown, kanji + radicals, and grammar patterns. Or just copy and ship.</p>
              <div className="step__visual">
                <div><span className="c">// explain</span></div>
                <div>忘れん <span className="c">→ wasure-n (neg)</span></div>
                <div>レシピ <span className="c">→ recipe (loanword)</span></div>
                <div>くれへん <span className="c">→ Kansai-ben request</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VIBE SHOW — the brand "moment" */}
      <section className="section section--tight">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow"><span className="tag tag--magenta">Vibe</span></div>
              <h2 className="section__title">One sentence. Six registers.</h2>
            </div>
            <p className="section__sub">A loanwords-and-keigo problem nobody else solves. We dial register without losing meaning. Same English source, six Japanese outputs.</p>
          </div>

          <div className="vibe-show">
            <div className="vibe-show__left">
              <div className="tag tag--accent" style={{marginBottom: 16}}><span className="dot"></span> SOURCE · EN-US</div>
              <div className="vibe-show__h">"Be quiet and follow me. You won't regret it."</div>
              <p className="vibe-show__p">A casual command in English. In Japanese, that single sentence shifts in ways English doesn't have grammar for — every register tier is a different relationship.</p>
              <button className="vt-btn vt-btn--primary" onClick={() => onNavigate('/app')}>Try it in the app <i data-lucide="arrow-right"></i></button>
            </div>
            <div className="vibe-show__right">
              <div className="tag" style={{marginBottom: 8}}>TARGET · JA-JP</div>
              {window.VIBE_PRESETS_PER_LANG['ja-JP'].map((v) => (
                <div className="vibe-show__pair" key={v.id} style={{'--vibe-color': v.color}}>
                  <span className="vibe-show__stop">{v.label}</span>
                  <span className="vibe-show__line" style={{fontFamily:'var(--font-sans)', fontSize: 17, lineHeight: 1.5}}>
                    {window.DEMO_PAIRS_JA[v.id]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow"><span className="tag">Features</span></div>
              <h2 className="section__title">Built for people who actually have to use the output.</h2>
            </div>
            <p className="section__sub">Localization shops, language learners, technical writers, support teams. Not for tourists copy-pasting menus.</p>
          </div>

          <div className="features">
            <div className="feature feature--accent-blue">
              <div className="feature__icon"><i data-lucide="sliders-horizontal"></i></div>
              <h3 className="feature__title">6-stop vibe slider</h3>
              <p className="feature__body">Per-language register stops. Yakuza → Emperor for JP. Banmal → Royal for KR. Tu → Vous for FR. Same dial, language-aware semantics.</p>
              <span className="feature__more">Adapts per target →</span>
            </div>
            <div className="feature feature--accent-magenta">
              <div className="feature__icon"><i data-lucide="user-square"></i></div>
              <h3 className="feature__title">Saved characters</h3>
              <p className="feature__body">Pin a translator persona — your boss, your grandma, the support team voice — with locked language pair, vibe, and temperature. Stop re-prompting.</p>
              <span className="feature__more">Per-character threads →</span>
            </div>
            <div className="feature feature--accent-cyan">
              <div className="feature__icon"><i data-lucide="book-open"></i></div>
              <h3 className="feature__title">Inline Explain</h3>
              <p className="feature__body">Word-by-word breakdown. Kanji with radicals. Grammar patterns with their literal meaning. JLPT tags. The translation IS the lesson.</p>
              <span className="feature__more">Built for learners →</span>
            </div>
            <div className="feature feature--accent-amber">
              <div className="feature__icon"><i data-lucide="thermometer"></i></div>
              <h3 className="feature__title">Temperature control</h3>
              <p className="feature__body">Want literal? Crank it down. Want a translator with personality? Crank it up. Per-character, persisted across sessions.</p>
            </div>
            <div className="feature feature--accent-turq">
              <div className="feature__icon"><i data-lucide="mic"></i></div>
              <h3 className="feature__title">Voice in, text out</h3>
              <p className="feature__body">Hit the mic, dictate the source. The character config carries the “translate to JP, casual” intent — you don't say it every time.</p>
            </div>
            <div className="feature feature--accent-orange">
              <div className="feature__icon"><i data-lucide="terminal"></i></div>
              <h3 className="feature__title">CAT-tool surface</h3>
              <p className="feature__body">Source on left, target on right. Past translations collapse to pills. No chat clutter. Built for people who translate dozens of segments a day.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow"><span className="tag">FAQ</span></div>
              <h2 className="section__title">Things people ask before they trust us with their words.</h2>
            </div>
            <p className="section__sub">Short answers. Click for the full version. The docs have the rest.</p>
          </div>

          <div className="faq">
            <FAQItem
              defaultOpen
              q="What model are you running?"
              a="Vibe Translate is a thin orchestration layer over a few frontier LLMs (currently a fine-tuned Claude Haiku for default and an Opus tier for the Linguist plan). Vibe levels and character configs are baked into the system prompt; we don't fine-tune on your data."
            />
            <FAQItem
              q="Why a vibe slider instead of just 'formal/informal'?"
              a="Because Japanese has six register tiers, Korean has five, and 'formal vs informal' loses a real-world distinction. A six-stop dial maps cleanly to the languages that need it; for languages that don't (English) it still gives you cussing-level control."
            />
            <FAQItem
              q="Do you store my translations?"
              a="On the Free plan, threads are persisted to your account so you can come back to them. We don't train on user data. Pro and Linguist plans get a 'zero retention' mode — the request leaves us with the response."
            />
            <FAQItem
              q="How is this different from Google Translate or DeepL?"
              a="They translate strings. We translate intent. Plus: saved characters, per-language register stops, an Explain panel for language learners, and a CAT-tool surface instead of a chat wrapper. The pricing page has a comparison."
            />
            <FAQItem
              q="What languages are supported?"
              a="38 today. Full register support (6-stop vibe) for JP, KR, ZH, DE, FR, ES, PT, IT, TR, RU. Other languages get a 3-stop fallback. Roadmap: VI, TH, AR full register support by Q3."
            />
            <FAQItem
              q="Can I use this from the command line?"
              a="Yes. `npx vibe-translate` and there's a Cargo crate. The Pro plan gives you 100k API tokens/mo; Linguist is unmetered for individuals. See the docs."
            />
            <FAQItem
              q="What about glossaries and translation memory?"
              a="Glossary is in beta — you can pin terms (e.g. 'PR' → 'プルリク') per character. Translation memory rolls out on the Linguist plan in May. For now, threads serve as a poor-man's TM."
            />
            <FAQItem
              q="Do you have a free tier?"
              a="Yes — 10k tokens a day, 3 saved characters, no API access. Enough to use it as a daily-driver translator if you're not running a localization shop."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-strip">
        <div className="cta-strip__halo"></div>
        <div className="cta-strip__inner">
          <span className="tag tag--accent"><span className="dot"></span> READY WHEN YOU ARE</span>
          <h2 className="cta-strip__title">Translate something nobody else can.</h2>
          <p className="cta-strip__sub">Free to start. No credit card. The first 10,000 tokens are on us.</p>
          <div className="hero__ctas">
            <button className="vt-btn vt-btn--primary vt-btn--lg" onClick={() => onNavigate('/app')}>Open the app</button>
            <button className="vt-btn vt-btn--ghost vt-btn--lg" onClick={() => onNavigate('/pricing')}>See pricing</button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer__grid">
            <div className="footer__brand">
              <a className="vt-mark" href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>
                <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">
                  <defs><mask id="ft-notch"><rect width="64" height="64" fill="white"/><circle cx="44" cy="22" r="14" fill="black"/></mask></defs>
                  <circle cx="32" cy="32" r="28" fill="currentColor" mask="url(#ft-notch)"/>
                  <circle cx="44" cy="22" r="6" fill="#1f7aff"/>
                </svg>
                <span className="vt-mark__name">Vibe Translate</span>
              </a>
              <p className="footer__tagline">A translation engine for shipping in more than one language. Built by Marrow Tech in San Francisco and Tokyo.</p>
            </div>
            <div>
              <h4 className="footer__col-h">Product</h4>
              <a className="footer__link" href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>Overview</a>
              <a className="footer__link" href="#/pricing" onClick={(e) => { e.preventDefault(); onNavigate('/pricing'); }}>Pricing</a>
              <a className="footer__link" href="#/app" onClick={(e) => { e.preventDefault(); onNavigate('/app'); }}>App</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>API</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Changelog</a>
            </div>
            <div>
              <h4 className="footer__col-h">Resources</h4>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Docs</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Vibe stops by language</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>JLPT tagging</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Status</a>
            </div>
            <div>
              <h4 className="footer__col-h">Marrow Tech</h4>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>About</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Engineering blog</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Careers</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Contact</a>
            </div>
            <div>
              <h4 className="footer__col-h">Legal</h4>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Terms</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>DPA</a>
              <a className="footer__link" href="#" onClick={(e) => e.preventDefault()}>Subprocessors</a>
            </div>
          </div>
          <div className="footer__bot">
            <span>© 2026 Marrow Tech, Inc.</span>
            <span style={{display:'flex',gap:24}}>
              <a href="#">Twitter</a>
              <a href="#">GitHub</a>
              <a href="#">Discord</a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
};
window.Landing = Landing;
