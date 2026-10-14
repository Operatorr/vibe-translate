import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import { cssVars } from '@/lib/css-vars'
import type { ExplainBody, ExplainMorpheme } from '@/lib/types'

const ROLE_COLOR: Record<ExplainMorpheme['role'], string> = {
  verb: 'var(--orange-400)',
  noun: 'var(--magenta-400)',
  particle: 'var(--cyan-400)',
  aux: 'var(--turq-400)',
  adjective: 'var(--amber-400)',
  adverb: 'var(--blue-400)',
  punct: 'var(--fg-subtle)',
  other: 'var(--fg-muted)',
}

const eyebrow = {
  font: '500 10px/1 var(--font-mono)',
  letterSpacing: '0.12em',
  color: 'var(--fg-subtle)',
  textTransform: 'uppercase' as const,
  marginBottom: 8,
}

const mono = { font: '400 14px/1.5 var(--font-mono)', color: 'var(--fg-muted)' }

// Unknown roles (a model drifting off the enum) render as `other` rather than
// inheriting a real part-of-speech color.
const roleOf = (role: string): ExplainMorpheme['role'] =>
  role in ROLE_COLOR ? (role as ExplainMorpheme['role']) : 'other'

function ExplainBodyView({ body }: { body: ExplainBody }) {
  const glosses = body.literalGloss ?? []
  const grammar = body.grammarPatterns ?? []
  const literal = glosses.map((g) => g.gloss).join(' · ')
  const hasMorphemes = (body.morphemes?.length ?? 0) > 0
  return (
    <>
      <div
        style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}
      >
        {body.romaji && (
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={eyebrow}>ROMAJI</div>
            <div style={mono}>{body.romaji}</div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={eyebrow}>LITERAL GLOSS</div>
          <div style={mono}>{literal}</div>
        </div>
      </div>

      <div className="explain__grid">
        <div className="explain__section">
          <div className="explain__section-h">
            {hasMorphemes ? 'MORPHEMES & PARTICLES' : 'WORD BY WORD'}
          </div>
          {hasMorphemes
            ? body.morphemes?.map((m, i) => (
                <div className="morpheme" key={i}>
                  <div>
                    <div className="morpheme__jp">{m.surface}</div>
                    <div className="morpheme__rom">{m.reading}</div>
                  </div>
                  <div className="morpheme__gloss">
                    {glosses.find((g) => g.token === m.surface)?.gloss ??
                      m.base}
                    {m.inflection ? (
                      <span style={{ color: 'var(--fg-subtle)' }}>
                        {' '}
                        · {m.inflection}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="morpheme__pos"
                    style={cssVars({
                      '--pos-color': ROLE_COLOR[roleOf(m.role)],
                    })}
                  >
                    {roleOf(m.role)}
                  </div>
                </div>
              ))
            : glosses.map((g, i) => (
                <div className="morpheme" key={i}>
                  <div>
                    <div className="morpheme__jp">{g.token}</div>
                  </div>
                  <div className="morpheme__gloss">{g.gloss}</div>
                  <div />
                </div>
              ))}
        </div>

        <div className="explain__section">
          {body.kanji && body.kanji.length > 0 && (
            <>
              <div className="explain__section-h">KANJI · BUILT FROM</div>
              {body.kanji.map((k, i) => (
                <div className="kanji" key={i}>
                  <div>
                    <div className="kanji__char">{k.char}</div>
                  </div>
                  <div className="kanji__body">
                    <div className="kanji__readings">
                      <span className="label">ON:</span>
                      <span className="on">{k.on.join(', ') || '—'}</span>
                      <span
                        style={{
                          margin: '0 10px',
                          color: 'var(--fg-disabled)',
                        }}
                      >
                        ·
                      </span>
                      <span className="label">KUN:</span>
                      <span className="kun">{k.kun.join(', ') || '—'}</span>
                    </div>
                    {k.radicals.length > 0 && (
                      <div className="kanji__radicals">
                        <span
                          style={{ color: 'var(--fg-subtle)', marginRight: 6 }}
                        >
                          RADICALS:
                        </span>
                        {k.radicals.map((r, j) => (
                          <span
                            key={j}
                            className="rad"
                            style={{ marginRight: 6, padding: '2px 6px' }}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      className="kanji__radicals"
                      style={{ color: 'var(--fg-subtle)' }}
                    >
                      {k.strokeCount} strokes
                    </div>
                    {k.jlpt && (
                      <span className="kanji__jlpt">JLPT {k.jlpt}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {grammar.length > 0 && (
            <>
              <div
                className="explain__section-h"
                style={{ marginTop: body.kanji?.length ? 16 : 0 }}
              >
                GRAMMAR PATTERNS
              </div>
              {grammar.map((g, i) => (
                <div className="grammar-pt" key={i}>
                  <div className="grammar-pt__pat">
                    <code>{g.pattern}</code>
                  </div>
                  <p className="grammar-pt__desc">
                    {g.note}
                    {g.dialectNote ? (
                      <span style={{ color: 'var(--turq-400)' }}>
                        {' '}
                        · {g.dialectNote}
                      </span>
                    ) : null}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  )
}

const REVEAL_GAP = 16

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (/(auto|scroll)/.test(overflowY) && p.scrollHeight > p.clientHeight)
      return p
  }
  return null
}

// Slide the thread up until the panel clears the composer, but never so far
// that the Segment card it explains scrolls off the top — the translation
// stays visible above its breakdown. If the card already starts above the
// fold, the panel's own top is the limit instead.
function revealPanel(panel: HTMLElement) {
  const scroller = scrollParent(panel)
  if (!scroller) return
  const view = scroller.getBoundingClientRect()
  const rect = panel.getBoundingClientRect()
  const overflow = rect.bottom + REVEAL_GAP - view.bottom
  if (overflow <= 0) return
  const cardTop = panel.parentElement?.getBoundingClientRect().top ?? rect.top
  const limit = (cardTop > view.top ? cardTop : rect.top) - view.top
  const shift = Math.min(overflow, Math.max(limit, 0))
  if (shift <= 0) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollBy({ top: shift, behavior: reduced ? 'auto' : 'smooth' })
}

export function ExplainPanel({
  body,
  isLoading,
  error,
  onClose,
  onRetry,
}: {
  body: ExplainBody | null | undefined
  isLoading: boolean
  error: unknown
  onClose: () => void
  onRetry: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  // Re-reveal when the content swaps (loader → breakdown / error):
  // the panel grows, and its new bottom may land behind the composer again.
  const phase = isLoading
    ? 'loading'
    : error != null
      ? 'error'
      : body
        ? 'body'
        : 'empty'
  React.useEffect(() => {
    if (ref.current) revealPanel(ref.current)
  }, [phase])
  return (
    <div className="explain" ref={ref}>
      <div className="explain__head">
        <div className="explain__title">
          <Icon name="book-open" /> EXPLAIN · WORD-BY-WORD
        </div>
        <button
          type="button"
          className="explain__close"
          onClick={onClose}
          aria-label="Close explain panel"
        >
          <Icon name="x" />
        </button>
      </div>

      {isLoading && (
        <div className="explain__state">
          <Icon name="loader" className="vt-spin" />
          <span>Breaking the sentence down…</span>
        </div>
      )}

      {!isLoading && error != null && (
        <div className="explain__state explain__state--error">
          <span>
            {error instanceof Error
              ? error.message
              : 'Could not generate the explanation.'}
          </span>
          <button
            type="button"
            className="vt-btn vt-btn--ghost"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && body && <ExplainBodyView body={body} />}
    </div>
  )
}
