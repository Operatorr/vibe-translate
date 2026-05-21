/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate } from '@tanstack/react-router'
import * as React from 'react'
import * as Icons from 'lucide-react'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  DEMO_PAIRS_JA,
  EXPLAIN_DEMO_S3,
  LANG_FLAG,
  LANG_NAME,
  SAMPLE_CHARS,
  SAMPLE_THREADS,
  VIBE_PRESETS_PER_LANG,
  getVibesForLang,
} from './design-data'

type VibeRoute = '/' | '/pricing' | '/app'
type CSSVars = CSSProperties &
  Record<`--${string}`, string | number | undefined>
type NavigateFn = (path: VibeRoute) => void

const cssVars = (vars: CSSVars): CSSVars => vars
const DEMO_PAIRS = DEMO_PAIRS_JA as Record<string, string>
const FLAGS = LANG_FLAG as Record<string, string>
const LANGUAGE_NAMES = LANG_NAME as Record<string, string>
const THREADS = SAMPLE_THREADS as Record<string, any[]>
const CHARACTERS = SAMPLE_CHARS as any[]
const VIBE_PRESETS = VIBE_PRESETS_PER_LANG as Record<string, any[]>

const ICONS: Record<string, LucideIcon> = {
  'arrow-left-right': Icons.ArrowLeftRight,
  'arrow-right': Icons.ArrowRight,
  'arrow-up-right': Icons.ArrowUpRight,
  book: Icons.Book,
  'book-open': Icons.BookOpen,
  braces: Icons.Braces,
  check: Icons.Check,
  'chevron-down': Icons.ChevronDown,
  'chevron-right': Icons.ChevronRight,
  copy: Icons.Copy,
  download: Icons.Download,
  'external-link': Icons.ExternalLink,
  'file-text': Icons.FileText,
  languages: Icons.Languages,
  loader: Icons.Loader,
  'log-out': Icons.LogOut,
  mic: Icons.Mic,
  minus: Icons.Minus,
  moon: Icons.Moon,
  'more-horizontal': Icons.MoreHorizontal,
  paperclip: Icons.Paperclip,
  plus: Icons.Plus,
  'rotate-ccw': Icons.RotateCcw,
  search: Icons.Search,
  'settings-2': Icons.Settings2,
  'share-2': Icons.Share2,
  'sliders-horizontal': Icons.SlidersHorizontal,
  star: Icons.Star,
  sun: Icons.Sun,
  'sun-moon': Icons.SunMoon,
  terminal: Icons.Terminal,
  thermometer: Icons.Thermometer,
  'user-plus': Icons.UserPlus,
  'user-square': Icons.UserSquare,
  'volume-2': Icons.Volume2,
  x: Icons.X,
}

type IconProps = { name: string; className?: string; style?: CSSProperties }

function Icon({ name, className, style }: IconProps) {
  const Glyph = ICONS[name] ?? Icons.Circle
  return (
    <i
      className={['vt-icon', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <Glyph strokeWidth={1.5} />
    </i>
  )
}

function useVibeFrame(route: VibeRoute) {
  const navigate = useNavigate()
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark')
  const [paletteOpen, setPaletteOpen] = React.useState(false)

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [route])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onNavigate = (path: VibeRoute) => {
    void navigate({ to: path as never })
  }

  const onToggleTheme = () =>
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))

  return { theme, paletteOpen, setPaletteOpen, onNavigate, onToggleTheme }
}

const PALETTE_ITEMS = [
  { id: 'new', label: 'New translation', icon: 'languages', hint: '⌘ N' },
  {
    id: 'mem',
    label: 'Open translation memory',
    icon: 'book-open',
    hint: 'G M',
  },
  { id: 'gloss', label: 'Open glossary', icon: 'braces', hint: 'G G' },
  { id: 'api', label: 'Open API console', icon: 'terminal', hint: 'G A' },
  { id: 'theme', label: 'Toggle theme', icon: 'sun-moon', hint: '⌘ ⇧ L' },
  { id: 'docs', label: 'Read the docs', icon: 'book', hint: '?' },
  { id: 'invite', label: 'Invite teammate', icon: 'user-plus', hint: null },
  { id: 'logout', label: 'Sign out', icon: 'log-out', hint: null },
]

const CommandPalette = ({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick?: (id: string) => void
}) => {
  const [q, setQ] = React.useState('')
  const filtered = PALETTE_ITEMS.filter((i) =>
    i.label.toLowerCase().includes(q.toLowerCase()),
  )
  React.useEffect(() => {
    if (open) setQ('')
  }, [open])
  if (!open) return null
  return (
    <div className="vt-palette-scrim" onClick={onClose}>
      <div className="vt-palette" onClick={(e) => e.stopPropagation()}>
        <div className="vt-palette__head">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Search or run a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd>esc</kbd>
        </div>
        <div className="vt-palette__list">
          {filtered.length === 0 && (
            <div className="vt-palette__empty">No results.</div>
          )}
          {filtered.map((i) => (
            <button
              key={i.id}
              className="vt-palette__item"
              onClick={() => {
                if (onPick) onPick(i.id)
                onClose()
              }}
            >
              <Icon name={i.icon} />
              <span className="vt-palette__label">{i.label}</span>
              {i.hint && <kbd className="vt-palette__hint">{i.hint}</kbd>}
            </button>
          ))}
        </div>
        <div className="vt-palette__foot">
          <span className="vt-eyebrow">COMMANDS</span>
          <span className="vt-palette__count">
            {filtered.length} of {PALETTE_ITEMS.length}
          </span>
        </div>
      </div>
    </div>
  )
}

const SiteNav = ({
  theme,
  onToggleTheme,
  route,
  onNavigate,
  onOpenPalette,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  route: VibeRoute
  onNavigate: NavigateFn
  onOpenPalette: () => void
}) => {
  return (
    <header className="vt-topnav">
      <div className="vt-topnav__left">
        <a
          className="vt-mark"
          href="#/"
          onClick={(e) => {
            e.preventDefault()
            onNavigate('/')
          }}
        >
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <mask id="sn-notch">
                <rect width="64" height="64" fill="white" />
                <circle cx="44" cy="22" r="14" fill="black" />
              </mask>
            </defs>
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="currentColor"
              mask="url(#sn-notch)"
            />
            <circle cx="44" cy="22" r="6" fill="#1f7aff" />
          </svg>
          <span className="vt-mark__name">Vibe Translate</span>
        </a>
        <nav className="vt-topnav__nav">
          <a
            className={
              'vt-navlink ' + (route === '/' ? 'vt-navlink--active' : '')
            }
            href="#/"
            onClick={(e) => {
              e.preventDefault()
              onNavigate('/')
            }}
          >
            Product
          </a>
          <a
            className={
              'vt-navlink ' + (route === '/pricing' ? 'vt-navlink--active' : '')
            }
            href="#/pricing"
            onClick={(e) => {
              e.preventDefault()
              onNavigate('/pricing')
            }}
          >
            Pricing
          </a>
          <a
            className={
              'vt-navlink ' + (route === '/app' ? 'vt-navlink--active' : '')
            }
            href="#/app"
            onClick={(e) => {
              e.preventDefault()
              onNavigate('/app')
            }}
          >
            App
          </a>
          <a
            className="vt-navlink"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Docs
          </a>
          <a
            className="vt-navlink"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Changelog
          </a>
        </nav>
      </div>
      <div className="vt-topnav__right">
        {route === '/app' && (
          <button className="vt-cmdk" onClick={onOpenPalette}>
            <Icon name="search" />
            <span>Search or jump to</span>
            <kbd>⌘K</kbd>
          </button>
        )}
        {route !== '/app' && (
          <a
            className="vt-navlink"
            href="#/app"
            onClick={(e) => {
              e.preventDefault()
              onNavigate('/app')
            }}
          >
            Sign in
          </a>
        )}
        <button
          className="vt-iconbtn"
          aria-label="Toggle theme"
          onClick={onToggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {route !== '/app' && (
          <button
            className="vt-btn vt-btn--primary"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => onNavigate('/app')}
          >
            Start translating
          </button>
        )}
        {route === '/app' && (
          <div className="vt-account">
            <div className="vt-avatar">M</div>
          </div>
        )}
      </div>
    </header>
  )
}

const LandingDemo = () => {
  const [text, setText] = React.useState(
    "Could you write down your recipe so I don't forget?",
  )
  const [vibeIdx, setVibeIdx] = React.useState(3) // keigo
  const [out, setOut] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [audioStatus, setAudioStatus] = React.useState<
    'idle' | 'loading' | 'playing'
  >('idle')
  const copyTimerRef = React.useRef<number | null>(null)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  const vibes = VIBE_PRESETS['ja-JP']
  const activeVibe = vibes[vibeIdx]
  const target = DEMO_PAIRS[activeVibe.id] || '...'
  const canUseOutput = out.trim().length > 0 && !busy
  const isAudioBusy = audioStatus !== 'idle'

  const releaseAudio = React.useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
  }, [])

  const run = () => {
    if (busy) return
    releaseAudio()
    setAudioStatus('idle')
    setBusy(true)
    setOut('')
    let i = 0
    const tick = () => {
      if (i <= target.length) {
        setOut(target.slice(0, i))
        i += Math.max(1, Math.round(target.length / 40))
        setTimeout(tick, 28)
      } else {
        setOut(target)
        setBusy(false)
      }
    }
    tick()
  }

  const copyOutput = async () => {
    if (!canUseOutput) return

    try {
      await navigator.clipboard.writeText(out)
      setCopied(true)
      toast.success('Copied translation.')

      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error('Copy failed.')
    }
  }

  // The landing demo plays pre-rendered, per-vibe sample clips from /public/demo
  // rather than the live (now authenticated, metered) TTS endpoint. See
  // public/demo/README.md and docs/SECURITY.md.
  const playOutput = async () => {
    if (!canUseOutput || isAudioBusy) return

    setAudioStatus('loading')

    try {
      releaseAudio()

      const audio = new Audio(`/demo/vibe-${activeVibe.id}.mp3`)
      audioRef.current = audio
      audio.onended = () => {
        releaseAudio()
        setAudioStatus('idle')
      }
      audio.onerror = () => {
        releaseAudio()
        setAudioStatus('idle')
        toast.error('Audio playback failed.')
      }

      setAudioStatus('playing')
      await audio.play()
    } catch (error) {
      releaseAudio()
      setAudioStatus('idle')
      toast.error(error instanceof Error ? error.message : 'Audio failed.')
    }
  }

  React.useEffect(() => {
    run()
  }, [vibeIdx]) // eslint-disable-line react-hooks/exhaustive-deps -- designer run loop is tied only to vibe changes.

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      releaseAudio()
    }
  }, [releaseAudio])

  return (
    <section className="demo">
      <div className="container">
        <div className="demo__frame">
          <div className="demo__bar">
            <div className="demo__bar-left">
              <div className="demo__bar-dots">
                <span
                  className="demo__bar-dot"
                  style={{ background: 'var(--red-400)' }}
                ></span>
                <span
                  className="demo__bar-dot"
                  style={{ background: 'var(--amber-400)' }}
                ></span>
                <span
                  className="demo__bar-dot"
                  style={{ background: 'var(--turq-400)' }}
                ></span>
              </div>
              <span>vibe-translate · live demo</span>
            </div>
            <div className="demo__bar-right">
              <span style={{ color: 'var(--turq-400)' }}>● online</span>
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
              <button className="demo__swap-inline" aria-label="Swap">
                <Icon name="arrow-left-right" />
              </button>
            </div>
            <div className="demo__head-cell">
              <span className="demo__head-flag">🇯🇵</span>
              <div className="demo__head-body">
                <span className="demo__head-eyebrow">
                  TO · {activeVibe.label.toUpperCase()}
                </span>
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
            <div className="demo__pane demo__pane--output">
              <div
                className="demo__output"
                style={{ fontSize: 22, lineHeight: 1.6 }}
              >
                {out || (
                  <span className="demo__output--empty">
                    Output streams here.
                  </span>
                )}
                {busy && <span className="vt-cursor"></span>}
              </div>
              <div className="demo__output-actions" aria-label="Output actions">
                <button
                  className={
                    'demo__icon-btn ' +
                    (audioStatus === 'loading' ? 'is-busy ' : '') +
                    (audioStatus === 'playing' ? 'is-active' : '')
                  }
                  onClick={playOutput}
                  disabled={!canUseOutput || isAudioBusy}
                  aria-label="Play translated audio"
                  title="Play audio"
                >
                  <Icon
                    name={audioStatus === 'loading' ? 'loader' : 'volume-2'}
                  />
                </button>
                <button
                  className={'demo__icon-btn ' + (copied ? 'is-active' : '')}
                  onClick={copyOutput}
                  disabled={!canUseOutput}
                  aria-label="Copy translated text"
                  title="Copy text"
                >
                  <Icon name={copied ? 'check' : 'copy'} />
                </button>
              </div>
            </div>
          </div>

          <div className="demo__ctrls">
            <div className="demo__vibe">
              <div className="vibe-mini__head">
                <span className="vibe-mini__head-l">VIBE · 6 stops</span>
                <span
                  className="vibe-mini__head-r"
                  style={{ color: activeVibe.color }}
                >
                  {activeVibe.label} · {activeVibe.hint}
                </span>
              </div>
              <div className="vibe-mini__rail-wrap">
                <div className="vibe-mini__rail"></div>
                <div
                  className="vibe-mini__fill"
                  style={{
                    width: `${(vibeIdx / (vibes.length - 1)) * 100}%`,
                    background: activeVibe.color,
                  }}
                ></div>
                <div className="vibe-mini__stops">
                  {vibes.map((v, i) => (
                    <button
                      key={v.id}
                      className={
                        'vibe-mini__dot ' + (i === vibeIdx ? 'is-active' : '')
                      }
                      style={cssVars({
                        left: `${(i / (vibes.length - 1)) * 100}%`,
                        '--vibe-fill': v.color,
                      })}
                      onClick={() => setVibeIdx(i)}
                      aria-label={v.label}
                    ></button>
                  ))}
                </div>
              </div>
              <div className="vibe-mini__labels">
                {vibes.map((v, i) => (
                  <span
                    key={v.id}
                    className={
                      'vibe-mini__label ' + (i === vibeIdx ? 'is-active' : '')
                    }
                    onClick={() => setVibeIdx(i)}
                    style={{ color: i === vibeIdx ? v.color : undefined }}
                  >
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{
                font: '400 11px/1 var(--font-mono)',
                color: 'var(--fg-subtle)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              ⌘ ↵ to run
            </div>
            <button
              className={'vt-btn vt-btn--primary ' + (busy ? 'is-busy' : '')}
              onClick={run}
              disabled={busy || !text.trim()}
            >
              {busy ? (
                <>
                  <Icon name="loader" /> Translating
                </>
              ) : (
                <>
                  Translate <kbd>↵</kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

const FAQItem = ({
  q,
  a,
  defaultOpen = false,
}: {
  q: string
  a: string
  defaultOpen?: boolean
}) => {
  const [open, setOpen] = React.useState(!!defaultOpen)
  return (
    <div
      className={'faq__item ' + (open ? 'faq__item--open' : '')}
      onClick={() => setOpen((o) => !o)}
    >
      <h3 className="faq__q">
        {q}
        <Icon name="plus" />
      </h3>
      <p className="faq__a">{a}</p>
    </div>
  )
}

const LandingContent = ({ onNavigate }: { onNavigate: NavigateFn }) => {
  return (
    <main className="site-main">
      {/* HERO */}
      <section className="hero">
        <div className="hero__halo"></div>
        <div className="container">
          <div className="hero__content">
            <div className="hero__eyebrow">
              <span className="tag tag--accent">
                <span className="dot"></span> v0.42 · Japanese keigo levels now
                respected
              </span>
            </div>
            <h1 className="hero__title">
              Translate the <em>vibe</em>,<br />
              not just the words.
            </h1>
            <p className="hero__sub">
              A translation engine for developers, technical writers, and anyone
              who has to ship in more than one language. Pick a tone. Pick a
              target. Translate intent, not strings.
            </p>
            <div className="hero__ctas">
              <button
                className="vt-btn vt-btn--primary vt-btn--lg"
                onClick={() => onNavigate('/app')}
              >
                Start translating <kbd>↵</kbd>
              </button>
              <button
                className="vt-btn vt-btn--ghost vt-btn--lg"
                onClick={() => onNavigate('/pricing')}
              >
                Read the docs <Icon name="arrow-up-right" />
              </button>
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
              <div className="section__eyebrow">
                <span className="tag">How it works</span>
              </div>
              <h2 className="section__title">
                Four steps. Zero translation memory baggage.
              </h2>
            </div>
            <p className="section__sub">
              No glossary upload. No pre-training. Drop a character config, pick
              a vibe, hit translate. Everything else — register, dialect,
              register-aware honorifics — is inferred.
            </p>
          </div>

          <div className="steps">
            <div className="step">
              <div className="step__num">01 / DEFINE</div>
              <h3 className="step__title">Build a character</h3>
              <p className="step__body">
                Age, region, formality, traits. The character becomes the system
                prompt — once, not every message.
              </p>
              <div className="step__visual">
                <div>
                  <span className="c">// character.toml</span>
                </div>
                <div>
                  <span className="k">name</span> ={' '}
                  <span className="v">"Oba-chan"</span>
                </div>
                <div>
                  <span className="k">target</span> ={' '}
                  <span className="v">"ja-JP"</span>
                </div>
                <div>
                  <span className="k">region</span> ={' '}
                  <span className="v">"Osaka"</span>
                </div>
                <div>
                  <span className="k">vibe</span> ={' '}
                  <span className="v">"casual"</span>
                </div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">02 / DIAL</div>
              <h3 className="step__title">Pick a vibe</h3>
              <p className="step__body">
                6 stops per target. JP runs Yakuza → Friend → Casual → Keigo →
                Keigo+ → Emperor. KR has banmal/jondaemal. Etc.
              </p>
              <div className="step__visual">
                <div>
                  <span className="c">vibe = casual</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {VIBE_PRESETS['ja-JP'].map((v, i) => (
                    <span
                      key={v.id}
                      style={{
                        height: 14,
                        width: 14,
                        background: i === 2 ? v.color : 'transparent',
                        border: '1px solid ' + v.color,
                        borderRadius: '50%',
                      }}
                    ></span>
                  ))}
                </div>
                <div>
                  <span className="c">// inferred</span>{' '}
                  <span className="v">"です/ます"</span>
                </div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">03 / RUN</div>
              <h3 className="step__title">Translate</h3>
              <p className="step__body">
                Streaming token-by-token. Cmd-↵ to run. Source on the left,
                target on the right, like a CAT tool — not a chat wrapper.
              </p>
              <div className="step__visual">
                <div>
                  <span className="c">{'>> input'}</span>
                </div>
                <div>"come over for dinner"</div>
                <div>
                  <span className="c">{'>> output'}</span>
                </div>
                <div style={{ color: 'var(--turq-400)' }}>
                  "晩ご飯食べに来てや"
                </div>
              </div>
            </div>
            <div className="step">
              <div className="step__num">04 / LEARN</div>
              <h3 className="step__title">Explain &amp; ship</h3>
              <p className="step__body">
                Hit “Explain” for word-by-word breakdown, kanji + radicals, and
                grammar patterns. Or just copy and ship.
              </p>
              <div className="step__visual">
                <div>
                  <span className="c">// explain</span>
                </div>
                <div>
                  忘れん <span className="c">→ wasure-n (neg)</span>
                </div>
                <div>
                  レシピ <span className="c">→ recipe (loanword)</span>
                </div>
                <div>
                  くれへん <span className="c">→ Kansai-ben request</span>
                </div>
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
              <div className="section__eyebrow">
                <span className="tag tag--magenta">Vibe</span>
              </div>
              <h2 className="section__title">One sentence. Six registers.</h2>
            </div>
            <p className="section__sub">
              A loanwords-and-keigo problem nobody else solves. We dial register
              without losing meaning. Same English source, six Japanese outputs.
            </p>
          </div>

          <div className="vibe-show">
            <div className="vibe-show__left">
              <div className="tag tag--accent" style={{ marginBottom: 16 }}>
                <span className="dot"></span> SOURCE · EN-US
              </div>
              <div className="vibe-show__h">
                "Be quiet and follow me. You won't regret it."
              </div>
              <p className="vibe-show__p">
                A casual command in English. In Japanese, that single sentence
                shifts in ways English doesn't have grammar for — every register
                tier is a different relationship.
              </p>
              <button
                className="vt-btn vt-btn--primary"
                onClick={() => onNavigate('/app')}
              >
                Try it in the app <Icon name="arrow-right" />
              </button>
            </div>
            <div className="vibe-show__right">
              <div className="tag" style={{ marginBottom: 8 }}>
                TARGET · JA-JP
              </div>
              {VIBE_PRESETS['ja-JP'].map((v) => (
                <div
                  className="vibe-show__pair"
                  key={v.id}
                  style={cssVars({ '--vibe-color': v.color })}
                >
                  <span className="vibe-show__stop">{v.label}</span>
                  <span
                    className="vibe-show__line"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 17,
                      lineHeight: 1.5,
                    }}
                  >
                    {DEMO_PAIRS[v.id]}
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
              <div className="section__eyebrow">
                <span className="tag">Features</span>
              </div>
              <h2 className="section__title">
                Built for people who actually have to use the output.
              </h2>
            </div>
            <p className="section__sub">
              Localization shops, language learners, technical writers, support
              teams. Not for tourists copy-pasting menus.
            </p>
          </div>

          <div className="features">
            <div className="feature feature--accent-blue">
              <div className="feature__icon">
                <Icon name="sliders-horizontal" />
              </div>
              <h3 className="feature__title">6-stop vibe slider</h3>
              <p className="feature__body">
                Per-language register stops. Yakuza → Emperor for JP. Banmal →
                Royal for KR. Tu → Vous for FR. Same dial, language-aware
                semantics.
              </p>
              <span className="feature__more">Adapts per target →</span>
            </div>
            <div className="feature feature--accent-magenta">
              <div className="feature__icon">
                <Icon name="user-square" />
              </div>
              <h3 className="feature__title">Saved characters</h3>
              <p className="feature__body">
                Pin a translator persona — your boss, your grandma, the support
                team voice — with locked language pair, vibe, and temperature.
                Stop re-prompting.
              </p>
              <span className="feature__more">Per-character threads →</span>
            </div>
            <div className="feature feature--accent-cyan">
              <div className="feature__icon">
                <Icon name="book-open" />
              </div>
              <h3 className="feature__title">Inline Explain</h3>
              <p className="feature__body">
                Word-by-word breakdown. Kanji with radicals. Grammar patterns
                with their literal meaning. JLPT tags. The translation IS the
                lesson.
              </p>
              <span className="feature__more">Built for learners →</span>
            </div>
            <div className="feature feature--accent-amber">
              <div className="feature__icon">
                <Icon name="thermometer" />
              </div>
              <h3 className="feature__title">Temperature control</h3>
              <p className="feature__body">
                Want literal? Crank it down. Want a translator with personality?
                Crank it up. Per-character, persisted across sessions.
              </p>
            </div>
            <div className="feature feature--accent-turq">
              <div className="feature__icon">
                <Icon name="mic" />
              </div>
              <h3 className="feature__title">Voice in, text out</h3>
              <p className="feature__body">
                Hit the mic, dictate the source. The character config carries
                the “translate to JP, casual” intent — you don't say it every
                time.
              </p>
            </div>
            <div className="feature feature--accent-orange">
              <div className="feature__icon">
                <Icon name="terminal" />
              </div>
              <h3 className="feature__title">CAT-tool surface</h3>
              <p className="feature__body">
                Source on left, target on right. Past translations collapse to
                pills. No chat clutter. Built for people who translate dozens of
                segments a day.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section">
        <div className="container">
          <div className="section__head">
            <div>
              <div className="section__eyebrow">
                <span className="tag">FAQ</span>
              </div>
              <h2 className="section__title">
                Things people ask before they trust us with their words.
              </h2>
            </div>
            <p className="section__sub">
              Short answers. Click for the full version. The docs have the rest.
            </p>
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
          <span className="tag tag--accent">
            <span className="dot"></span> READY WHEN YOU ARE
          </span>
          <h2 className="cta-strip__title">
            Translate something nobody else can.
          </h2>
          <p className="cta-strip__sub">
            Free to start. No credit card. The first 10,000 tokens are on us.
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
              onClick={() => onNavigate('/pricing')}
            >
              See pricing
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer__grid">
            <div className="footer__brand">
              <a
                className="vt-mark"
                href="#/"
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate('/')
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 64 64"
                  aria-hidden="true"
                >
                  <defs>
                    <mask id="ft-notch">
                      <rect width="64" height="64" fill="white" />
                      <circle cx="44" cy="22" r="14" fill="black" />
                    </mask>
                  </defs>
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="currentColor"
                    mask="url(#ft-notch)"
                  />
                  <circle cx="44" cy="22" r="6" fill="#1f7aff" />
                </svg>
                <span className="vt-mark__name">Vibe Translate</span>
              </a>
              <p className="footer__tagline">
                A translation engine for shipping in more than one language.
                Built by Marrow Tech in San Francisco and Tokyo.
              </p>
            </div>
            <div>
              <h4 className="footer__col-h">Product</h4>
              <a
                className="footer__link"
                href="#/"
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate('/')
                }}
              >
                Overview
              </a>
              <a
                className="footer__link"
                href="#/pricing"
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate('/pricing')
                }}
              >
                Pricing
              </a>
              <a
                className="footer__link"
                href="#/app"
                onClick={(e) => {
                  e.preventDefault()
                  onNavigate('/app')
                }}
              >
                App
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                API
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Changelog
              </a>
            </div>
            <div>
              <h4 className="footer__col-h">Resources</h4>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Docs
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Vibe stops by language
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                JLPT tagging
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Status
              </a>
            </div>
            <div>
              <h4 className="footer__col-h">Marrow Tech</h4>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                About
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Engineering blog
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Careers
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Contact
              </a>
            </div>
            <div>
              <h4 className="footer__col-h">Legal</h4>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Privacy
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Terms
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                DPA
              </a>
              <a
                className="footer__link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Subprocessors
              </a>
            </div>
          </div>
          <div className="footer__bot">
            <span>© 2026 Marrow Tech, Inc.</span>
            <span style={{ display: 'flex', gap: 24 }}>
              <a href="#">Twitter</a>
              <a href="#">GitHub</a>
              <a href="#">Discord</a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  )
}

const PricingContent = ({ onNavigate }: { onNavigate: NavigateFn }) => {
  const [annual, setAnnual] = React.useState(true)

  const price = (m: number, y: number) => (annual ? `$${y}` : `$${m}`)

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
                For language learners and the curious. Daily-driver translator
                without the bill.
              </p>
              <div className="tier__price">
                <span className="tier__price-num">$0</span>
                <span className="tier__price-unit">/ forever</span>
              </div>
              <div className="tier__price-meta">
                no credit card · 10k tokens / day
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
                    <strong>10k tokens</strong> per day
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
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Inline Explain (limited to 20 / day)</span>
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
                For technical writers and devs shipping in 2+ languages. The
                Explain panel comes off the leash.
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
                onClick={() => onNavigate('/app')}
              >
                Start 14-day trial
              </button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN FREE, PLUS</div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>1M tokens</strong> per month
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>Unlimited</strong> saved characters
                  </span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>Unlimited Explain panels</span>
                </div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>API access · 100k tok/mo</span>
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
                For localization shops and full-time translators. Unmetered,
                premium model, every feature on.
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
                onClick={() => onNavigate('/app')}
              >
                Start 14-day trial
              </button>
              <div className="tier__features">
                <div className="tier__features-h">EVERYTHING IN PRO, PLUS</div>
                <div className="tier__feat">
                  <Icon name="check" />
                  <span>
                    <strong>Unmetered</strong> tokens
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
                  <span>API · unmetered for individual use</span>
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
                <td>Daily token quota</td>
                <td>10k</td>
                <td>33k (1M / mo)</td>
                <td>Unmetered</td>
              </tr>
              <tr>
                <td>Saved characters</td>
                <td>3</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
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
                <td>20 / day</td>
                <td>Unlimited</td>
                <td>Unlimited</td>
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
                <td>100k tok / mo</td>
                <td>Unmetered</td>
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
                What counts as a token?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                Roughly 0.75 words for Latin-script languages. For CJK, one
                token ≈ one character. Both source and target tokens count
                toward your quota. The composer shows a live token estimate as
                you type.
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
                What if I run out of tokens on Pro?
                <Icon name="plus" />
              </h3>
              <p className="faq__a">
                You'll get an email at 80% and 100%. Past 100% you can either
                wait until the next period (the app falls back to read-only on
                saved threads) or top up at $0.01 per 1k tokens.
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

const VibeMini = ({
  vibes,
  valueIdx,
  onChange,
}: {
  vibes: any[]
  valueIdx: number
  onChange: (value: number) => void
}) => {
  const active = vibes[valueIdx] || vibes[0]
  return (
    <div className="vibe-mini">
      <div className="vibe-mini__head">
        <span className="vibe-mini__head-l">VIBE · {vibes.length} STOPS</span>
        <span className="vibe-mini__head-r" style={{ color: active.color }}>
          {active.label} · {active.hint}
        </span>
      </div>
      <div className="vibe-mini__rail-wrap">
        <div className="vibe-mini__rail"></div>
        <div
          className="vibe-mini__fill"
          style={{
            width: `${(valueIdx / (vibes.length - 1)) * 100}%`,
            background: active.color,
          }}
        ></div>
        <div className="vibe-mini__stops">
          {vibes.map((v, i) => (
            <button
              key={v.id}
              className={
                'vibe-mini__dot ' + (i === valueIdx ? 'is-active' : '')
              }
              style={cssVars({
                left: `${(i / (vibes.length - 1)) * 100}%`,
                '--vibe-fill': v.color,
              })}
              onClick={() => onChange(i)}
              aria-label={v.label}
            />
          ))}
        </div>
      </div>
      <div className="vibe-mini__labels">
        {vibes.map((v, i) => (
          <span
            key={v.id}
            className={
              'vibe-mini__label ' + (i === valueIdx ? 'is-active' : '')
            }
            onClick={() => onChange(i)}
            style={{ color: i === valueIdx ? v.color : undefined }}
          >
            {v.label}
          </span>
        ))}
      </div>
    </div>
  )
}

const TempSlider = ({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) => (
  <div className="temp">
    <div className="temp__head">
      <span className="temp__h-l">TEMPERATURE</span>
      <span className="temp__h-r">{value.toFixed(2)}</span>
    </div>
    <div className="temp__rail-wrap">
      <div className="temp__rail"></div>
      <div className="temp__thumb" style={{ left: `${value * 100}%` }}></div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  </div>
)

const ExplainPanel = ({
  data,
  onClose,
}: {
  data: any
  onClose: () => void
}) => {
  return (
    <div className="explain">
      <div className="explain__head">
        <div className="explain__title">
          <Icon name="book-open" /> EXPLAIN · WORD-BY-WORD
        </div>
        <button className="explain__close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>

      <div
        style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              font: '500 10px/1 var(--font-mono)',
              letterSpacing: '0.12em',
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            ROMAJI
          </div>
          <div
            style={{
              font: '400 14px/1.5 var(--font-mono)',
              color: 'var(--fg-muted)',
            }}
          >
            {data.romaji}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              font: '500 10px/1 var(--font-mono)',
              letterSpacing: '0.12em',
              color: 'var(--fg-subtle)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            LITERAL GLOSS
          </div>
          <div
            style={{
              font: '400 14px/1.5 var(--font-mono)',
              color: 'var(--fg-muted)',
            }}
          >
            {data.literal}
          </div>
        </div>
      </div>

      <div className="explain__grid">
        <div className="explain__section">
          <div className="explain__section-h">MORPHEMES &amp; PARTICLES</div>
          {data.morphemes.map((m: any, i: number) => (
            <div className="morpheme" key={i}>
              <div>
                <div className="morpheme__jp">{m.jp}</div>
                <div className="morpheme__rom">{m.rom}</div>
              </div>
              <div className="morpheme__gloss">{m.gloss}</div>
              <div
                className="morpheme__pos"
                style={cssVars({ '--pos-color': m.posColor })}
              >
                {m.pos}
              </div>
            </div>
          ))}
        </div>

        <div className="explain__section">
          <div className="explain__section-h">KANJI · BUILT FROM</div>
          {data.kanji.map((k: any, i: number) => (
            <div className="kanji" key={i}>
              <div>
                <div className="kanji__char">{k.c}</div>
                <div className="kanji__char-meaning">{k.meaning}</div>
              </div>
              <div className="kanji__body">
                <div className="kanji__readings">
                  <span className="label">ON:</span>
                  <span className="on">{k.on}</span>
                  <span
                    style={{ margin: '0 10px', color: 'var(--fg-disabled)' }}
                  >
                    ·
                  </span>
                  <span className="label">KUN:</span>
                  <span className="kun">{k.kun}</span>
                </div>
                <div className="kanji__radicals">
                  <span style={{ color: 'var(--fg-subtle)', marginRight: 6 }}>
                    RADICALS:
                  </span>
                  {k.radicals.map((r: string, j: number) => (
                    <span
                      key={j}
                      className="rad"
                      style={{ marginRight: 6, padding: '2px 6px' }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
                <div
                  className="kanji__radicals"
                  style={{ color: 'var(--fg-subtle)' }}
                >
                  {k.strokes} strokes
                </div>
                <span className="kanji__jlpt">JLPT {k.jlpt}</span>
              </div>
            </div>
          ))}

          <div className="explain__section-h" style={{ marginTop: 16 }}>
            GRAMMAR PATTERNS
          </div>
          {data.grammar.map((g: any, i: number) => (
            <div className="grammar-pt" key={i}>
              <div className="grammar-pt__pat">
                <code>{g.pat}</code>
              </div>
              <p className="grammar-pt__desc">{g.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const Segment = ({
  seg,
  idx,
  isActive,
  onExpand,
  onExplainToggle,
  explainOpen,
  onHoverTok,
  hoveredTok,
}: {
  seg: any
  idx: number
  isActive: boolean
  onExpand: (id: string) => void
  onExplainToggle: (id: string) => void
  explainOpen: boolean
  onHoverTok: (token: string | null) => void
  hoveredTok: string | null
}) => {
  return (
    <div className={'segment ' + (isActive ? 'segment--active' : '')}>
      <div className="segment__row">
        <div className="segment__num">{String(idx).padStart(2, '0')}</div>

        {seg.collapsed ? (
          <div
            className="segment__src is-collapsed"
            style={{ gridColumn: '2 / 3' }}
          >
            <button
              className="segment__src-pill"
              onClick={() => onExpand(seg.id)}
              title={seg.source}
            >
              <Icon name="file-text" />
              <span className="text">{seg.source}</span>
              <Icon name="chevron-down" />
            </button>
          </div>
        ) : (
          <div className="segment__src">
            <div
              style={{
                font: '500 10px/1 var(--font-mono)',
                letterSpacing: '0.12em',
                color: 'var(--fg-subtle)',
                textTransform: 'uppercase',
              }}
            >
              SOURCE · EN-US
            </div>
            <div className="segment__src-text">
              {seg.source.split(/(\s+)/).map((w: string, i: number) => {
                if (!w.trim()) return w
                const isPaired =
                  hoveredTok &&
                  seg.target &&
                  seg.target.some(
                    (p: any) =>
                      p.src &&
                      p.src.toLowerCase().includes(w.toLowerCase()) &&
                      p.t === hoveredTok,
                  )
                return (
                  <span
                    key={i}
                    className={'tok ' + (isPaired ? 'is-paired' : '')}
                  >
                    {w}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {!seg.collapsed && <div className="segment__divider"></div>}

        <div
          className="segment__tgt"
          style={seg.collapsed ? { gridColumn: '3 / 5' } : undefined}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div
              style={{
                font: '500 10px/1 var(--font-mono)',
                letterSpacing: '0.12em',
                color: 'var(--fg-subtle)',
                textTransform: 'uppercase',
              }}
            >
              TARGET · JA-JP
            </div>
            <div className="segment__tgt-meta">{seg.tokens} tok</div>
          </div>
          <div className="segment__tgt-text segment__tgt-text--ja">
            {seg.target
              ? seg.target.map((p: any, i: number) => (
                  <span
                    key={i}
                    className={'tok ' + (hoveredTok === p.t ? 'is-paired' : '')}
                    onMouseEnter={() => onHoverTok(p.t)}
                    onMouseLeave={() => onHoverTok(null)}
                    title={p.src ? `↔ ${p.src}` : ''}
                  >
                    {p.t}
                  </span>
                ))
              : seg.targetText}
          </div>
          <div className="segment__tgt-row">
            <div className="segment__actions">
              <button className="segment__action">
                <Icon name="copy" /> COPY
              </button>
              <button className="segment__action">
                <Icon name="rotate-ccw" /> RETRY
              </button>
              <button className="segment__action">
                <Icon name="volume-2" /> SPEAK
              </button>
              <button
                className={
                  'segment__action segment__action--explain ' +
                  (explainOpen ? 'is-open' : '')
                }
                onClick={() => onExplainToggle(seg.id)}
              >
                <Icon name="book-open" /> EXPLAIN
              </button>
            </div>
          </div>
        </div>
      </div>

      {explainOpen && (
        <ExplainPanel
          data={EXPLAIN_DEMO_S3}
          onClose={() => onExplainToggle(seg.id)}
        />
      )}
    </div>
  )
}

const CustomizePanel = ({
  char,
  onClose,
}: {
  char: any
  onClose: () => void
}) => {
  const [name, setName] = React.useState(char.name)
  const [age, setAge] = React.useState(char.persona.age)
  const [region, setRegion] = React.useState(char.persona.region)
  const [tone, setTone] = React.useState('warm')
  const [verbosity, setVerbosity] = React.useState(0.4)
  const [creativity, setCreativity] = React.useState(char.temp)
  const [traits, setTraits] = React.useState(new Set(char.persona.traits))

  const TRAIT_OPTIONS = [
    'warm',
    'direct',
    'playful',
    'formal',
    'blunt',
    'poetic',
    'technical',
    'gen-z',
    'dialect: kansai-ben',
    'dialect: tohoku',
    'no slang',
    'uses 尊敬語',
    'classical grammar',
    'occasional code-switch',
    'casual contractions',
  ]

  const toggleTrait = (t: string) => {
    const s = new Set(traits)
    if (s.has(t)) s.delete(t)
    else s.add(t)
    setTraits(s)
  }

  const sysprompt = `<character name="${name}">\n  age: ${age}\n  region: ${region}\n  tone: ${tone}\n  verbosity: ${verbosity.toFixed(2)}\n  traits: [${Array.from(
    traits,
  )
    .map((t) => '"' + t + '"')
    .join(
      ', ',
    )}]\n  vibe: ${char.vibe}\n  temperature: ${creativity.toFixed(2)}\n</character>\n\n# Translate the user's message from English (US) to Japanese\n# preserving intent, register, and dialect.`

  return (
    <>
      <div className="cust-scrim" onClick={onClose}></div>
      <aside className="cust">
        <div className="cust__head">
          <h3 className="cust__title">Customize character · {char.name}</h3>
          <button className="cust__close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="cust__body">
          <div className="cust__group">
            <div className="cust__group-h">IDENTITY</div>
            <div className="cust__field">
              <label className="cust__label">Name</label>
              <input
                className="cust__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="cust__field">
              <label className="cust__label">Age</label>
              <input
                className="cust__input"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>
            <div className="cust__field">
              <label className="cust__label">Region</label>
              <select
                className="cust__select"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option>Tokyo</option>
                <option>Osaka</option>
                <option>Kyoto</option>
                <option>Hokkaido</option>
                <option>Okinawa</option>
                <option>Imperial Court</option>
                <option>São Paulo</option>
                <option>Seoul</option>
              </select>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">VOICE</div>
            <div className="cust__field">
              <label className="cust__label">Tone</label>
              <select
                className="cust__select"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                <option value="warm">Warm</option>
                <option value="dry">Dry</option>
                <option value="playful">Playful</option>
                <option value="stern">Stern</option>
                <option value="ceremonial">Ceremonial</option>
              </select>
            </div>
            <div className="cust__field">
              <label className="cust__label">Verbosity</label>
              <div className="cust__slider-wrap">
                <div className="cust__slider-track">
                  <div className="cust__slider-rail"></div>
                  <div
                    className="cust__slider-fill"
                    style={{ width: `${verbosity * 100}%` }}
                  ></div>
                  <div
                    className="cust__slider-thumb"
                    style={{ left: `${verbosity * 100}%` }}
                  ></div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={verbosity}
                    onChange={(e) => setVerbosity(parseFloat(e.target.value))}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0,
                      width: '100%',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <span className="cust__slider-val">{verbosity.toFixed(2)}</span>
              </div>
            </div>
            <div className="cust__field">
              <label className="cust__label">Creativity</label>
              <div className="cust__slider-wrap">
                <div className="cust__slider-track">
                  <div className="cust__slider-rail"></div>
                  <div
                    className="cust__slider-fill"
                    style={{ width: `${creativity * 100}%` }}
                  ></div>
                  <div
                    className="cust__slider-thumb"
                    style={{ left: `${creativity * 100}%` }}
                  ></div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={creativity}
                    onChange={(e) => setCreativity(parseFloat(e.target.value))}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0,
                      width: '100%',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <span className="cust__slider-val">
                  {creativity.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">TRAITS</div>
            <div className="cust__chip-row">
              {TRAIT_OPTIONS.map((t) => (
                <button
                  key={t}
                  className={'cust__chip ' + (traits.has(t) ? 'is-active' : '')}
                  onClick={() => toggleTrait(t)}
                >
                  {traits.has(t) && '✓ '}
                  {t}
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
          <button className="vt-btn vt-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="vt-btn vt-btn--primary" onClick={onClose}>
            Save character
          </button>
        </div>
      </aside>
    </>
  )
}

const AppExperience = ({
  paletteOpen,
  setPaletteOpen,
  onToggleTheme,
}: {
  paletteOpen: boolean
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>
  onToggleTheme: () => void
}) => {
  const [activeCharId, setActiveCharId] = React.useState('c1')
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    't1',
  )
  const [custOpen, setCustOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [recording, setRecording] = React.useState(false)

  const char = CHARACTERS.find((c) => c.id === activeCharId) ?? CHARACTERS[0]
  const threads = THREADS[activeCharId] || []
  const thread = threads.find((t) => t.id === activeThreadId) || threads[0]

  const vibes = getVibesForLang(char.to)
  const initialVibeIdx = Math.max(
    0,
    vibes.findIndex((v) => v.id === char.vibe),
  )
  const [vibeIdx, setVibeIdx] = React.useState(initialVibeIdx)
  const [temp, setTemp] = React.useState(char.temp)
  React.useEffect(() => {
    const newVibes = getVibesForLang(char.to)
    setVibeIdx(
      Math.max(
        0,
        newVibes.findIndex((v) => v.id === char.vibe),
      ),
    )
    setTemp(char.temp)
  }, [activeCharId, char.temp, char.to, char.vibe])

  const [segments, setSegments] = React.useState<any[]>(thread?.segments || [])
  React.useEffect(() => {
    setSegments(thread?.segments || [])
    setExplainOpenId(null)
  }, [activeCharId, activeThreadId, thread?.segments])

  const [hoveredTok, setHoveredTok] = React.useState<string | null>(null)
  const [explainOpenId, setExplainOpenId] = React.useState<string | null>('s3')

  const expandSeg = (id: string) =>
    setSegments((segs: any[]) =>
      segs.map((s: any) => (s.id === id ? { ...s, collapsed: false } : s)),
    )
  const toggleExplain = (id: string) =>
    setExplainOpenId((curr) => (curr === id ? null : id))

  const sendNew = () => {
    if (!draft.trim()) return
    const newSeg = {
      id: 's' + Date.now(),
      source: draft,
      targetText: '...',
      target: [{ t: '…', src: draft }],
      tokens: Math.round(draft.length / 4),
    }
    // collapse all existing
    const collapsed = segments.map((s: any) => ({ ...s, collapsed: true }))
    setSegments([newSeg, ...collapsed])
    setExplainOpenId(null)
    setDraft('')

    // fake stream a response
    setTimeout(() => {
      setSegments((curr: any[]) =>
        curr.map((s: any) =>
          s.id === newSeg.id
            ? {
                ...s,
                target: [
                  { t: 'うん', src: 'yes' },
                  { t: '、', src: ',' },
                  { t: '分かった', src: 'understood' },
                  { t: 'よ', src: '(emphasis)' },
                  { t: '。', src: '.' },
                ],
                targetText: 'うん、分かったよ。',
                tokens: 24,
              }
            : s,
        ),
      )
    }, 500)
  }

  return (
    <>
      <div className="app-body">
        {/* CHARACTERS sidebar */}
        <aside className="chars">
          <div className="chars__head">
            <span className="chars__head-title">
              CHARACTERS · {CHARACTERS.length}
            </span>
            <button className="chars__new" aria-label="New character">
              <Icon name="plus" />
            </button>
          </div>
          <div className="chars__list">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                className={
                  'char ' + (c.id === activeCharId ? 'char--active' : '')
                }
                style={cssVars({ '--char-color': c.color })}
                onClick={() => {
                  setActiveCharId(c.id)
                  const t = THREADS[c.id] || []
                  setActiveThreadId(t[0]?.id || null)
                }}
              >
                <div className="char__avatar" style={{ background: c.color }}>
                  {c.initials}
                </div>
                <div className="char__body">
                  <div className="char__name">{c.name}</div>
                  <div className="char__meta">
                    {FLAGS[c.from]}
                    <span className="arrow">→</span>
                    {FLAGS[c.to]} ·{' '}
                    {getVibesForLang(c.to).find((v) => v.id === c.vibe)?.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="chars__foot">
            <div className="vt-side-foot" style={{ padding: 0, border: 0 }}>
              <div
                className="vt-status-dot"
                style={{ background: 'var(--turq-400)' }}
              ></div>
              <div className="vt-status-text">Pro · 312k / 1M tok</div>
              <Icon name="external-link" className="vt-status-ext" />
            </div>
          </div>
        </aside>

        {/* THREADS sidebar */}
        <aside className="threads">
          <div
            className="threads__head"
            style={cssVars({ '--char-color': char.color })}
          >
            <div className="threads__char-row">
              <div
                className="threads__char-avatar"
                style={{ background: char.color }}
              >
                {char.initials}
              </div>
              <div>
                <div className="threads__char-name">{char.name}</div>
                <div className="threads__char-meta">
                  {LANGUAGE_NAMES[char.from]} → {LANGUAGE_NAMES[char.to]}
                </div>
              </div>
            </div>
            <button
              className="threads__customize"
              onClick={() => setCustOpen(true)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="settings-2" />
                Customize character
              </span>
              <Icon name="chevron-right" />
            </button>
            <button className="threads__newbtn">
              <Icon name="plus" /> New translation thread
            </button>
          </div>
          <div className="threads__list">
            <div className="threads__group-h">RECENT</div>
            {threads.map((t) => (
              <button
                key={t.id}
                className={
                  'thread ' + (t.id === activeThreadId ? 'thread--active' : '')
                }
                onClick={() => setActiveThreadId(t.id)}
              >
                <p className="thread__title">{t.title}</p>
                <div className="thread__meta">
                  <span className="count">{t.segCount} translations</span>
                  <span
                    style={{ margin: '0 6px', color: 'var(--fg-disabled)' }}
                  >
                    ·
                  </span>
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
                <h2 className="workspace__title">
                  {thread?.title || 'New translation'}
                </h2>
                <div className="workspace__pair">
                  {FLAGS[char.from]} {LANGUAGE_NAMES[char.from]}
                  <span className="arrow">→</span>
                  {FLAGS[char.to]} {LANGUAGE_NAMES[char.to]}
                  <span className="arrow">·</span>
                  <span style={{ color: vibes[vibeIdx].color }}>
                    {vibes[vibeIdx].label}
                  </span>
                  <span className="arrow">·</span>
                  T={temp.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="workspace__head-right">
              <button className="workspace__icon-btn" title="Star">
                <Icon name="star" />
              </button>
              <button className="workspace__icon-btn" title="Share">
                <Icon name="share-2" />
              </button>
              <button className="workspace__icon-btn" title="Export">
                <Icon name="download" />
              </button>
              <button className="workspace__icon-btn" title="More">
                <Icon name="more-horizontal" />
              </button>
            </div>
          </div>

          <div className="workspace__scroll">
            {segments.length === 0 ? (
              <div className="welcome">
                <Icon
                  name="languages"
                  style={{ width: 32, height: 32, color: 'var(--fg-subtle)' }}
                />
                <h3 className="welcome__title">No translations yet</h3>
                <p className="welcome__sub">
                  Type below to translate something. The character settings
                  carry the intent — you don't have to say "translate to
                  Japanese."
                </p>
              </div>
            ) : (
              segments.map((s: any, i: number) => (
                <Segment
                  key={s.id}
                  seg={s}
                  idx={segments.length - i}
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
              <VibeMini
                vibes={vibes}
                valueIdx={vibeIdx}
                onChange={setVibeIdx}
              />
              <TempSlider value={temp} onChange={setTemp} />
            </div>
            <div className="composer__row">
              <div className="composer__field">
                <textarea
                  className="composer__textarea"
                  placeholder={`Translate to ${LANGUAGE_NAMES[char.to]} as ${char.name} · ${vibes[vibeIdx].label}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      sendNew()
                    }
                  }}
                />
                <div className="composer__field-foot">
                  <span>
                    {draft.length} chars · ~
                    {Math.max(0, Math.round(draft.length / 4))} tok
                  </span>
                  <div className="composer__icons">
                    <button
                      className={
                        'composer__icon-btn ' + (recording ? 'is-active' : '')
                      }
                      title="Voice dictate"
                      onClick={() => setRecording((r) => !r)}
                    >
                      <Icon name={recording ? 'mic' : 'mic'} />
                    </button>
                    <button className="composer__icon-btn" title="Attach file">
                      <Icon name="paperclip" />
                    </button>
                    <button className="composer__icon-btn" title="Glossary">
                      <Icon name="braces" />
                    </button>
                  </div>
                </div>
              </div>
              <button
                className="composer__send"
                onClick={sendNew}
                disabled={!draft.trim()}
                title="Translate · ⌘↵"
              >
                <Icon name="arrow-right" />
              </button>
            </div>
          </div>
        </main>
      </div>

      {custOpen && (
        <CustomizePanel char={char} onClose={() => setCustOpen(false)} />
      )}

      {paletteOpen && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onPick={(id) => {
            if (id === 'theme') onToggleTheme()
          }}
        />
      )}
    </>
  )
}

export function VibeLandingPage() {
  const frame = useVibeFrame('/')

  return (
    <div className="site">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
      />
      <LandingContent onNavigate={frame.onNavigate} />
    </div>
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

export function VibeAppPage() {
  const frame = useVibeFrame('/app')

  return (
    <div className="app-shell">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/app"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
      />
      <AppExperience
        paletteOpen={frame.paletteOpen}
        setPaletteOpen={frame.setPaletteOpen}
        onToggleTheme={frame.onToggleTheme}
      />
    </div>
  )
}
