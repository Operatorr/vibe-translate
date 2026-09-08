import { Link } from '@tanstack/react-router'

import { Icon } from '@/components/vibe-design/icon'
import { ApiError } from '@/lib/api'
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

function ExplainBodyView({ body }: { body: ExplainBody }) {
  const literal = body.literalGloss.map((g) => g.gloss).join(' · ')
  const hasJa = (body.morphemes?.length ?? 0) > 0 || (body.kanji?.length ?? 0) > 0
  return (
    <>
      <div style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
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
            {hasJa ? 'MORPHEMES & PARTICLES' : 'WORD BY WORD'}
          </div>
          {hasJa
            ? body.morphemes?.map((m, i) => (
                <div className="morpheme" key={i}>
                  <div>
                    <div className="morpheme__jp">{m.surface}</div>
                    <div className="morpheme__rom">{m.reading}</div>
                  </div>
                  <div className="morpheme__gloss">
                    {body.literalGloss.find((g) => g.token === m.surface)?.gloss ?? m.base}
                    {m.inflection ? (
                      <span style={{ color: 'var(--fg-subtle)' }}> · {m.inflection}</span>
                    ) : null}
                  </div>
                  <div className="morpheme__pos" style={cssVars({ '--pos-color': ROLE_COLOR[m.role] })}>
                    {m.role}
                  </div>
                </div>
              ))
            : body.literalGloss.map((g, i) => (
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
                      <span style={{ margin: '0 10px', color: 'var(--fg-disabled)' }}>·</span>
                      <span className="label">KUN:</span>
                      <span className="kun">{k.kun.join(', ') || '—'}</span>
                    </div>
                    {k.radicals.length > 0 && (
                      <div className="kanji__radicals">
                        <span style={{ color: 'var(--fg-subtle)', marginRight: 6 }}>RADICALS:</span>
                        {k.radicals.map((r, j) => (
                          <span key={j} className="rad" style={{ marginRight: 6, padding: '2px 6px' }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="kanji__radicals" style={{ color: 'var(--fg-subtle)' }}>
                      {k.strokeCount} strokes
                    </div>
                    {k.jlpt && <span className="kanji__jlpt">JLPT {k.jlpt}</span>}
                  </div>
                </div>
              ))}
            </>
          )}

          {body.grammarPatterns.length > 0 && (
            <>
              <div className="explain__section-h" style={{ marginTop: body.kanji?.length ? 16 : 0 }}>
                GRAMMAR PATTERNS
              </div>
              {body.grammarPatterns.map((g, i) => (
                <div className="grammar-pt" key={i}>
                  <div className="grammar-pt__pat">
                    <code>{g.pattern}</code>
                  </div>
                  <p className="grammar-pt__desc">
                    {g.note}
                    {g.dialectNote ? (
                      <span style={{ color: 'var(--turq-400)' }}> · {g.dialectNote}</span>
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
  const gated = error instanceof ApiError && error.status === 403
  return (
    <div className="explain">
      <div className="explain__head">
        <div className="explain__title">
          <Icon name="book-open" /> EXPLAIN · WORD-BY-WORD
        </div>
        <button className="explain__close" onClick={onClose} aria-label="Close explain panel">
          <Icon name="x" />
        </button>
      </div>

      {isLoading && (
        <div className="explain__state">
          <Icon name="loader" className="vt-spin" />
          <span>Breaking the sentence down…</span>
        </div>
      )}

      {!isLoading && gated && (
        <div className="explain__state explain__state--gate">
          <div>
            <strong>Explain is a Pro feature.</strong>
            <p>
              Romaji, morphemes, kanji radicals, JLPT levels and grammar patterns for every
              translation.
            </p>
          </div>
          <Link className="vt-btn vt-btn--primary" to={'/pricing' as never}>
            Upgrade to Pro
          </Link>
        </div>
      )}

      {!isLoading && error != null && !gated && (
        <div className="explain__state explain__state--error">
          <span>{error instanceof Error ? error.message : 'Could not generate the explanation.'}</span>
          <button className="vt-btn vt-btn--ghost" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && body && <ExplainBodyView body={body} />}
    </div>
  )
}
