// AppPage.jsx — The translation app: 3-column shell, characters / threads / CAT workspace + Explain + Customize panel

const VibeMini = ({ vibes, valueIdx, onChange }) => {
  const active = vibes[valueIdx] || vibes[0];
  return (
    <div className="vibe-mini">
      <div className="vibe-mini__head">
        <span className="vibe-mini__head-l">VIBE · {vibes.length} STOPS</span>
        <span className="vibe-mini__head-r" style={{color: active.color}}>{active.label} · {active.hint}</span>
      </div>
      <div className="vibe-mini__rail-wrap">
        <div className="vibe-mini__rail"></div>
        <div className="vibe-mini__fill" style={{width: `${(valueIdx/(vibes.length-1))*100}%`, background: active.color}}></div>
        <div className="vibe-mini__stops">
          {vibes.map((v, i) => (
            <button key={v.id}
              className={"vibe-mini__dot " + (i === valueIdx ? 'is-active' : '')}
              style={{left: `${(i/(vibes.length-1))*100}%`, '--vibe-fill': v.color}}
              onClick={() => onChange(i)}
              aria-label={v.label}
            />
          ))}
        </div>
      </div>
      <div className="vibe-mini__labels">
        {vibes.map((v, i) => (
          <span key={v.id}
            className={"vibe-mini__label " + (i === valueIdx ? 'is-active' : '')}
            onClick={() => onChange(i)}
            style={{color: i === valueIdx ? v.color : undefined}}>
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const TempSlider = ({ value, onChange }) => (
  <div className="temp">
    <div className="temp__head">
      <span className="temp__h-l">TEMPERATURE</span>
      <span className="temp__h-r">{value.toFixed(2)}</span>
    </div>
    <div className="temp__rail-wrap">
      <div className="temp__rail"></div>
      <div className="temp__thumb" style={{left: `${value * 100}%`}}></div>
      <input type="range" min="0" max="1" step="0.05" value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  </div>
);

const ExplainPanel = ({ data, onClose }) => {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });
  return (
    <div className="explain">
      <div className="explain__head">
        <div className="explain__title"><i data-lucide="book-open"></i> EXPLAIN · WORD-BY-WORD</div>
        <button className="explain__close" onClick={onClose} aria-label="Close"><i data-lucide="x"></i></button>
      </div>

      <div style={{display:'flex',gap:24,marginBottom:20,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:240}}>
          <div style={{font:'500 10px/1 var(--font-mono)',letterSpacing:'0.12em',color:'var(--fg-subtle)',textTransform:'uppercase',marginBottom:8}}>ROMAJI</div>
          <div style={{font:'400 14px/1.5 var(--font-mono)',color:'var(--fg-muted)'}}>{data.romaji}</div>
        </div>
        <div style={{flex:1,minWidth:240}}>
          <div style={{font:'500 10px/1 var(--font-mono)',letterSpacing:'0.12em',color:'var(--fg-subtle)',textTransform:'uppercase',marginBottom:8}}>LITERAL GLOSS</div>
          <div style={{font:'400 14px/1.5 var(--font-mono)',color:'var(--fg-muted)'}}>{data.literal}</div>
        </div>
      </div>

      <div className="explain__grid">
        <div className="explain__section">
          <div className="explain__section-h">MORPHEMES &amp; PARTICLES</div>
          {data.morphemes.map((m, i) => (
            <div className="morpheme" key={i}>
              <div>
                <div className="morpheme__jp">{m.jp}</div>
                <div className="morpheme__rom">{m.rom}</div>
              </div>
              <div className="morpheme__gloss">{m.gloss}</div>
              <div className="morpheme__pos" style={{'--pos-color': m.posColor}}>{m.pos}</div>
            </div>
          ))}
        </div>

        <div className="explain__section">
          <div className="explain__section-h">KANJI · BUILT FROM</div>
          {data.kanji.map((k, i) => (
            <div className="kanji" key={i}>
              <div>
                <div className="kanji__char">{k.c}</div>
                <div className="kanji__char-meaning">{k.meaning}</div>
              </div>
              <div className="kanji__body">
                <div className="kanji__readings">
                  <span className="label">ON:</span><span className="on">{k.on}</span>
                  <span style={{margin:'0 10px',color:'var(--fg-disabled)'}}>·</span>
                  <span className="label">KUN:</span><span className="kun">{k.kun}</span>
                </div>
                <div className="kanji__radicals">
                  <span style={{color:'var(--fg-subtle)',marginRight:6}}>RADICALS:</span>
                  {k.radicals.map((r, j) => (
                    <span key={j} className="rad" style={{marginRight:6,padding:'2px 6px'}}>{r}</span>
                  ))}
                </div>
                <div className="kanji__radicals" style={{color:'var(--fg-subtle)'}}>{k.strokes} strokes</div>
                <span className="kanji__jlpt">JLPT {k.jlpt}</span>
              </div>
            </div>
          ))}

          <div className="explain__section-h" style={{marginTop:16}}>GRAMMAR PATTERNS</div>
          {data.grammar.map((g, i) => (
            <div className="grammar-pt" key={i}>
              <div className="grammar-pt__pat"><code>{g.pat}</code></div>
              <p className="grammar-pt__desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Segment = ({ seg, idx, isActive, onExpand, onExplainToggle, explainOpen, onHoverTok, hoveredTok }) => {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });
  return (
    <div className={"segment " + (isActive ? 'segment--active' : '')}>
      <div className="segment__row">
        <div className="segment__num">{String(idx).padStart(2,'0')}</div>

        {seg.collapsed ? (
          <div className="segment__src is-collapsed" style={{gridColumn:'2 / 3'}}>
            <button className="segment__src-pill" onClick={() => onExpand(seg.id)} title={seg.source}>
              <i data-lucide="file-text"></i>
              <span className="text">{seg.source}</span>
              <i data-lucide="chevron-down"></i>
            </button>
          </div>
        ) : (
          <div className="segment__src">
            <div style={{font:'500 10px/1 var(--font-mono)',letterSpacing:'0.12em',color:'var(--fg-subtle)',textTransform:'uppercase'}}>SOURCE · EN-US</div>
            <div className="segment__src-text">
              {seg.source.split(/(\s+)/).map((w, i) => {
                if (!w.trim()) return w;
                const isPaired = hoveredTok && seg.target && seg.target.some(p => p.src && p.src.toLowerCase().includes(w.toLowerCase()) && p.t === hoveredTok);
                return <span key={i} className={"tok " + (isPaired ? 'is-paired' : '')}>{w}</span>;
              })}
            </div>
          </div>
        )}

        {!seg.collapsed && <div className="segment__divider"></div>}

        <div className="segment__tgt" style={seg.collapsed ? {gridColumn:'3 / 5'} : null}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
            <div style={{font:'500 10px/1 var(--font-mono)',letterSpacing:'0.12em',color:'var(--fg-subtle)',textTransform:'uppercase'}}>TARGET · JA-JP</div>
            <div className="segment__tgt-meta">{seg.tokens} tok</div>
          </div>
          <div className="segment__tgt-text segment__tgt-text--ja">
            {seg.target ? seg.target.map((p, i) => (
              <span key={i}
                className={"tok " + (hoveredTok === p.t ? 'is-paired' : '')}
                onMouseEnter={() => onHoverTok(p.t)}
                onMouseLeave={() => onHoverTok(null)}
                title={p.src ? `↔ ${p.src}` : ''}
              >{p.t}</span>
            )) : seg.targetText}
          </div>
          <div className="segment__tgt-row">
            <div className="segment__actions">
              <button className="segment__action"><i data-lucide="copy"></i> COPY</button>
              <button className="segment__action"><i data-lucide="rotate-ccw"></i> RETRY</button>
              <button className="segment__action"><i data-lucide="volume-2"></i> SPEAK</button>
              <button
                className={"segment__action segment__action--explain " + (explainOpen ? 'is-open' : '')}
                onClick={() => onExplainToggle(seg.id)}
              >
                <i data-lucide="book-open"></i> EXPLAIN
              </button>
            </div>
          </div>
        </div>
      </div>

      {explainOpen && <ExplainPanel data={window.EXPLAIN_DEMO_S3} onClose={() => onExplainToggle(seg.id)} />}
    </div>
  );
};

const CustomizePanel = ({ char, onClose }) => {
  const [name, setName] = React.useState(char.name);
  const [age, setAge] = React.useState(char.persona.age);
  const [region, setRegion] = React.useState(char.persona.region);
  const [tone, setTone] = React.useState('warm');
  const [verbosity, setVerbosity] = React.useState(0.4);
  const [creativity, setCreativity] = React.useState(char.temp);
  const [traits, setTraits] = React.useState(new Set(char.persona.traits));

  const TRAIT_OPTIONS = ['warm','direct','playful','formal','blunt','poetic','technical','gen-z','dialect: kansai-ben','dialect: tohoku','no slang','uses 尊敬語','classical grammar','occasional code-switch','casual contractions'];

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });

  const toggleTrait = (t) => {
    const s = new Set(traits);
    if (s.has(t)) s.delete(t); else s.add(t);
    setTraits(s);
  };

  const sysprompt = `<character name="${name}">\n  age: ${age}\n  region: ${region}\n  tone: ${tone}\n  verbosity: ${verbosity.toFixed(2)}\n  traits: [${Array.from(traits).map(t => '"'+t+'"').join(', ')}]\n  vibe: ${char.vibe}\n  temperature: ${creativity.toFixed(2)}\n</character>\n\n# Translate the user's message from English (US) to Japanese\n# preserving intent, register, and dialect.`;

  return (
    <>
      <div className="cust-scrim" onClick={onClose}></div>
      <aside className="cust">
        <div className="cust__head">
          <h3 className="cust__title">Customize character · {char.name}</h3>
          <button className="cust__close" onClick={onClose} aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <div className="cust__body">
          <div className="cust__group">
            <div className="cust__group-h">IDENTITY</div>
            <div className="cust__field">
              <label className="cust__label">Name</label>
              <input className="cust__input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="cust__field">
              <label className="cust__label">Age</label>
              <input className="cust__input" value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div className="cust__field">
              <label className="cust__label">Region</label>
              <select className="cust__select" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option>Tokyo</option><option>Osaka</option><option>Kyoto</option><option>Hokkaido</option><option>Okinawa</option><option>Imperial Court</option><option>São Paulo</option><option>Seoul</option>
              </select>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">VOICE</div>
            <div className="cust__field">
              <label className="cust__label">Tone</label>
              <select className="cust__select" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="warm">Warm</option><option value="dry">Dry</option><option value="playful">Playful</option><option value="stern">Stern</option><option value="ceremonial">Ceremonial</option>
              </select>
            </div>
            <div className="cust__field">
              <label className="cust__label">Verbosity</label>
              <div className="cust__slider-wrap">
                <div className="cust__slider-track">
                  <div className="cust__slider-rail"></div>
                  <div className="cust__slider-fill" style={{width: `${verbosity*100}%`}}></div>
                  <div className="cust__slider-thumb" style={{left: `${verbosity*100}%`}}></div>
                  <input type="range" min="0" max="1" step="0.05" value={verbosity} onChange={(e) => setVerbosity(parseFloat(e.target.value))} style={{position:'absolute',inset:0,opacity:0,width:'100%',cursor:'pointer'}} />
                </div>
                <span className="cust__slider-val">{verbosity.toFixed(2)}</span>
              </div>
            </div>
            <div className="cust__field">
              <label className="cust__label">Creativity</label>
              <div className="cust__slider-wrap">
                <div className="cust__slider-track">
                  <div className="cust__slider-rail"></div>
                  <div className="cust__slider-fill" style={{width: `${creativity*100}%`}}></div>
                  <div className="cust__slider-thumb" style={{left: `${creativity*100}%`}}></div>
                  <input type="range" min="0" max="1" step="0.05" value={creativity} onChange={(e) => setCreativity(parseFloat(e.target.value))} style={{position:'absolute',inset:0,opacity:0,width:'100%',cursor:'pointer'}} />
                </div>
                <span className="cust__slider-val">{creativity.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">TRAITS</div>
            <div className="cust__chip-row">
              {TRAIT_OPTIONS.map(t => (
                <button key={t} className={"cust__chip " + (traits.has(t) ? 'is-active' : '')} onClick={() => toggleTrait(t)}>
                  {traits.has(t) && '✓ '}{t}
                </button>
              ))}
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">SYSTEM PROMPT · COMPILED</div>
            <pre className="cust__sysprompt">{sysprompt}</pre>
          </div>
        </div>
        <div className="cust__foot">
          <button className="vt-btn vt-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="vt-btn vt-btn--primary" onClick={onClose}>Save character</button>
        </div>
      </aside>
    </>
  );
};

const AppPage = ({ paletteOpen, setPaletteOpen, theme, onToggleTheme, onNavigate }) => {
  const [activeCharId, setActiveCharId] = React.useState('c1');
  const [activeThreadId, setActiveThreadId] = React.useState('t1');
  const [custOpen, setCustOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [recording, setRecording] = React.useState(false);

  const char = window.SAMPLE_CHARS.find(c => c.id === activeCharId);
  const threads = window.SAMPLE_THREADS[activeCharId] || [];
  const thread = threads.find(t => t.id === activeThreadId) || threads[0];

  const vibes = window.getVibesForLang(char.to);
  const initialVibeIdx = Math.max(0, vibes.findIndex(v => v.id === char.vibe));
  const [vibeIdx, setVibeIdx] = React.useState(initialVibeIdx);
  const [temp, setTemp] = React.useState(char.temp);
  React.useEffect(() => {
    const newVibes = window.getVibesForLang(char.to);
    setVibeIdx(Math.max(0, newVibes.findIndex(v => v.id === char.vibe)));
    setTemp(char.temp);
  }, [activeCharId]);

  const [segments, setSegments] = React.useState(thread?.segments || []);
  React.useEffect(() => { setSegments(thread?.segments || []); setExplainOpenId(null); }, [activeCharId, activeThreadId]);

  const [hoveredTok, setHoveredTok] = React.useState(null);
  const [explainOpenId, setExplainOpenId] = React.useState('s3');

  const expandSeg = (id) => setSegments(segs => segs.map(s => s.id === id ? {...s, collapsed: false} : s));
  const toggleExplain = (id) => setExplainOpenId(curr => curr === id ? null : id);

  const sendNew = () => {
    if (!draft.trim()) return;
    const newSeg = {
      id: 's' + Date.now(),
      source: draft,
      targetText: '...',
      target: [{t:'…', src: draft}],
      tokens: Math.round(draft.length / 4),
    };
    // collapse all existing
    const collapsed = segments.map(s => ({...s, collapsed: true}));
    setSegments([newSeg, ...collapsed]);
    setExplainOpenId(null);
    setDraft('');

    // fake stream a response
    setTimeout(() => {
      setSegments(curr => curr.map(s => s.id === newSeg.id ? {
        ...s,
        target: [
          { t:'うん', src:'yes' },
          { t:'、', src:',' },
          { t:'分かった', src:'understood' },
          { t:'よ', src:'(emphasis)' },
          { t:'。', src:'.' },
        ],
        targetText: 'うん、分かったよ。',
        tokens: 24,
      } : s));
    }, 500);
  };

  React.useEffect(() => { if (window.lucide) window.lucide.createIcons({attrs:{"stroke-width":1.5}}); });

  return (
    <div className="app-shell">
      <div className="app-body">
        {/* CHARACTERS sidebar */}
        <aside className="chars">
          <div className="chars__head">
            <span className="chars__head-title">CHARACTERS · {window.SAMPLE_CHARS.length}</span>
            <button className="chars__new" aria-label="New character"><i data-lucide="plus"></i></button>
          </div>
          <div className="chars__list">
            {window.SAMPLE_CHARS.map(c => (
              <button key={c.id}
                className={"char " + (c.id === activeCharId ? 'char--active' : '')}
                style={{'--char-color': c.color}}
                onClick={() => { setActiveCharId(c.id); const t = window.SAMPLE_THREADS[c.id] || []; setActiveThreadId(t[0]?.id || null); }}
              >
                <div className="char__avatar" style={{background: c.color}}>{c.initials}</div>
                <div className="char__body">
                  <div className="char__name">{c.name}</div>
                  <div className="char__meta">
                    {window.LANG_FLAG[c.from]}<span className="arrow">→</span>{window.LANG_FLAG[c.to]} · {window.getVibesForLang(c.to).find(v => v.id === c.vibe)?.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="chars__foot">
            <div className="vt-side-foot" style={{padding: 0, border: 0}}>
              <div className="vt-status-dot" style={{background:'var(--turq-400)'}}></div>
              <div className="vt-status-text">Pro · 312k / 1M tok</div>
              <i data-lucide="external-link" className="vt-status-ext"></i>
            </div>
          </div>
        </aside>

        {/* THREADS sidebar */}
        <aside className="threads">
          <div className="threads__head" style={{'--char-color': char.color}}>
            <div className="threads__char-row">
              <div className="threads__char-avatar" style={{background: char.color}}>{char.initials}</div>
              <div>
                <div className="threads__char-name">{char.name}</div>
                <div className="threads__char-meta">{window.LANG_NAME[char.from]} → {window.LANG_NAME[char.to]}</div>
              </div>
            </div>
            <button className="threads__customize" onClick={() => setCustOpen(true)}>
              <span style={{display:'flex',alignItems:'center',gap:8}}><i data-lucide="settings-2"></i>Customize character</span>
              <i data-lucide="chevron-right"></i>
            </button>
            <button className="threads__newbtn">
              <i data-lucide="plus"></i> New translation thread
            </button>
          </div>
          <div className="threads__list">
            <div className="threads__group-h">RECENT</div>
            {threads.map(t => (
              <button key={t.id}
                className={"thread " + (t.id === activeThreadId ? 'thread--active' : '')}
                onClick={() => setActiveThreadId(t.id)}>
                <p className="thread__title">{t.title}</p>
                <div className="thread__meta">
                  <span className="count">{t.segCount} translations</span>
                  <span style={{margin:'0 6px',color:'var(--fg-disabled)'}}>·</span>
                  <span>{t.when}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* WORKSPACE — the main translation surface */}
        <main className="workspace">
          <div className="workspace__head">
            <div className="workspace__head-left">
              <div className="workspace__title-block">
                <h2 className="workspace__title">{thread?.title || 'New translation'}</h2>
                <div className="workspace__pair">
                  {window.LANG_FLAG[char.from]} {window.LANG_NAME[char.from]}
                  <span className="arrow">→</span>
                  {window.LANG_FLAG[char.to]} {window.LANG_NAME[char.to]}
                  <span className="arrow">·</span>
                  <span style={{color: vibes[vibeIdx].color}}>{vibes[vibeIdx].label}</span>
                  <span className="arrow">·</span>
                  T={temp.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="workspace__head-right">
              <button className="workspace__icon-btn" title="Star"><i data-lucide="star"></i></button>
              <button className="workspace__icon-btn" title="Share"><i data-lucide="share-2"></i></button>
              <button className="workspace__icon-btn" title="Export"><i data-lucide="download"></i></button>
              <button className="workspace__icon-btn" title="More"><i data-lucide="more-horizontal"></i></button>
            </div>
          </div>

          <div className="workspace__scroll">
            {segments.length === 0 ? (
              <div className="welcome">
                <i data-lucide="languages" style={{width:32,height:32,color:'var(--fg-subtle)'}}></i>
                <h3 className="welcome__title">No translations yet</h3>
                <p className="welcome__sub">Type below to translate something. The character settings carry the intent — you don't have to say "translate to Japanese."</p>
              </div>
            ) : (
              segments.map((s, i) => (
                <Segment key={s.id} seg={s} idx={segments.length - i}
                  isActive={i === 0}
                  onExpand={expandSeg}
                  onExplainToggle={toggleExplain}
                  explainOpen={explainOpenId === s.id}
                  onHoverTok={setHoveredTok}
                  hoveredTok={hoveredTok}
                />
              ))
            )}
          </div>

          <div className="composer">
            <div className="composer__settings">
              <VibeMini vibes={vibes} valueIdx={vibeIdx} onChange={setVibeIdx} />
              <TempSlider value={temp} onChange={setTemp} />
            </div>
            <div className="composer__row">
              <div className="composer__field">
                <textarea
                  className="composer__textarea"
                  placeholder={`Translate to ${window.LANG_NAME[char.to]} as ${char.name} · ${vibes[vibeIdx].label}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendNew(); }
                  }}
                />
                <div className="composer__field-foot">
                  <span>{draft.length} chars · ~{Math.max(0, Math.round(draft.length / 4))} tok</span>
                  <div className="composer__icons">
                    <button className={"composer__icon-btn " + (recording ? 'is-active' : '')} title="Voice dictate" onClick={() => setRecording(r => !r)}><i data-lucide={recording ? 'mic' : 'mic'}></i></button>
                    <button className="composer__icon-btn" title="Attach file"><i data-lucide="paperclip"></i></button>
                    <button className="composer__icon-btn" title="Glossary"><i data-lucide="braces"></i></button>
                  </div>
                </div>
              </div>
              <button className="composer__send" onClick={sendNew} disabled={!draft.trim()} title="Translate · ⌘↵">
                <i data-lucide="arrow-right"></i>
              </button>
            </div>
          </div>
        </main>
      </div>

      {custOpen && <CustomizePanel char={char} onClose={() => setCustOpen(false)} />}

      {paletteOpen && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onPick={(id) => {
        if (id === 'theme') onToggleTheme();
      }} />}
    </div>
  );
};
window.AppPage = AppPage;
