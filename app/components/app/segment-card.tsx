import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import type { ExplainBody, SegmentToken, VibeStop } from '@/lib/types'
import { normalizeWord, srcWordSet } from '@/lib/alignment'

import { ExplainPanel } from './explain-panel'

export type SegmentView = {
  id: string
  sourceText: string
  targetText: string
  vibe: VibeStop | null
  tokenAlignment: SegmentToken[]
  tokenUsage?: Record<string, unknown>
  createdAt: string
}

export type SegmentExplainState = {
  open: boolean
  body: ExplainBody | null | undefined
  isLoading: boolean
  error: unknown
  onToggle: () => void
  onRetry: () => void
}

const eyebrow: React.CSSProperties = {
  font: '500 10px/1 var(--font-mono)',
  letterSpacing: '0.12em',
  color: 'var(--fg-subtle)',
  textTransform: 'uppercase',
}

// The worker stamps `{ cached: true }` on Segments served from the shared
// translation cache. Rows with unknown usage show nothing rather than a guess.
function tokenMeta(seg: SegmentView): string {
  const usage = seg.tokenUsage ?? {}
  if (usage.cached === true) return 'cached · 0 cr'
  const completion = Number(usage.completionTokens)
  if (Number.isFinite(completion) && completion > 0) return `${completion} tok`
  return ''
}

// Alignment selection: a target token index, plus whether it was pinned by a
// tap/click (sticky until tapped again or tapped outside the card) or is a
// transient mouse hover.
type Selection = { index: number; pinned: boolean } | null

export function SegmentCard({
  seg,
  idx,
  isActive,
  collapsed,
  sourceLanguage,
  targetLanguage,
  vibes,
  defaultVibe,
  onExpand,
  explain,
  onCopy,
  onRetry,
  retrying,
  onSpeak,
  speaking,
  readOnly,
}: {
  seg: SegmentView
  idx: number
  isActive: boolean
  collapsed: boolean
  sourceLanguage: string
  targetLanguage: string
  vibes: VibePreset[]
  defaultVibe: VibeStop
  onExpand: (id: string) => void
  explain?: SegmentExplainState
  onCopy: (seg: SegmentView) => void
  onRetry?: (seg: SegmentView) => void
  retrying?: boolean
  onSpeak: (seg: SegmentView) => void
  speaking?: boolean
  readOnly?: boolean
}) {
  // Hover-align state lives per card so hovering a token re-renders only this
  // card, not the whole shell.
  const [selection, setSelection] = React.useState<Selection>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const vibe = vibes.find((v) => v.id === (seg.vibe ?? defaultVibe))
  const isJa = /^ja([-_]|$)/i.test(targetLanguage)
  // Memoized so the no-alignment fallback keeps a stable identity across renders.
  const tokens = React.useMemo(
    () =>
      seg.tokenAlignment.length > 0
        ? seg.tokenAlignment
        : [{ t: seg.targetText, src: seg.sourceText }],
    [seg.tokenAlignment, seg.targetText, seg.sourceText],
  )
  const srcSets = React.useMemo(
    () => tokens.map((tok) => srcWordSet(tok.src)),
    [tokens],
  )
  const selectedSrc = selection ? srcSets[selection.index] : undefined

  // A retry replaces the alignment; drop a selection that now points elsewhere.
  React.useEffect(() => setSelection(null), [tokens])

  // A pinned (tapped) selection clears when a tap lands outside this card.
  React.useEffect(() => {
    if (!selection?.pinned) return
    const onDown = (event: PointerEvent) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node))
        setSelection(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [selection?.pinned])

  // Mouse gets transient hover. Touch/pen synthesize enter events right before
  // the click, which used to select and then immediately un-select on the same
  // tap — so they only act on the tap itself, which pins/unpins.
  const alignProps = (index: number) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && index >= 0) {
        setSelection((curr) => (curr?.pinned ? curr : { index, pinned: false }))
      }
    },
    onClick: () =>
      setSelection((curr) =>
        index < 0 || (curr?.pinned && curr.index === index)
          ? null
          : { index, pinned: true },
      ),
  })
  const clearHover = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse')
      setSelection((curr) => (curr?.pinned ? curr : null))
  }
  const meta = readOnly ? '' : tokenMeta(seg)

  return (
    <div
      className={
        'segment ' +
        (isActive ? 'segment--active ' : '') +
        (collapsed ? 'segment--collapsed' : '')
      }
      id={`segment-${seg.id}`}
    >
      <div className="segment__row" ref={rowRef}>
        <div className="segment__num">{String(idx).padStart(2, '0')}</div>

        {collapsed ? (
          <div className="segment__src is-collapsed">
            <button
              type="button"
              className="segment__src-pill"
              onClick={() => onExpand(seg.id)}
              title={seg.sourceText}
              aria-expanded={false}
            >
              <Icon name="file-text" />
              <span className="text">{seg.sourceText}</span>
              <Icon name="chevron-down" />
            </button>
          </div>
        ) : (
          <div className="segment__src">
            <div style={eyebrow}>SOURCE · {sourceLanguage}</div>
            <div className="segment__src-text" onPointerLeave={clearHover}>
              {seg.sourceText.split(/(\s+)/).map((w, i) => {
                if (!w.trim()) return w
                const word = normalizeWord(w)
                const paired = !!word && !!selectedSrc?.has(word)
                // Source → target direction: a word selects the first target
                // token whose `src` span contains that exact word.
                const tokenIndex = word
                  ? srcSets.findIndex((set) => set.has(word))
                  : -1
                return (
                  <span
                    key={i}
                    className={'tok ' + (paired ? 'is-paired' : '')}
                    {...alignProps(tokenIndex)}
                  >
                    {w}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <div className="segment__divider"></div>

        <div className="segment__tgt">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <div style={eyebrow}>
              TARGET · {targetLanguage}
              {vibe && (
                <span style={{ color: vibe.color, marginLeft: 8 }}>
                  {vibe.label}
                </span>
              )}
            </div>
            {meta && <div className="segment__tgt-meta">{meta}</div>}
          </div>
          <div
            className={
              'segment__tgt-text ' + (isJa ? 'segment__tgt-text--ja' : '')
            }
            onPointerLeave={clearHover}
          >
            {tokens.map((p, i) => (
              <span
                key={i}
                className={'tok ' + (selection?.index === i ? 'is-paired' : '')}
                title={p.src ? `↔ ${p.src}` : ''}
                {...alignProps(i)}
              >
                {p.t}
              </span>
            ))}
          </div>
          <div className="segment__tgt-row">
            <div className="segment__actions">
              <button
                type="button"
                className="segment__action"
                onClick={() => onCopy(seg)}
                title="Copy translation"
              >
                <Icon name="copy" /> COPY
              </button>
              {!readOnly && onRetry && (
                <button
                  type="button"
                  className={'segment__action ' + (retrying ? 'is-busy' : '')}
                  onClick={() => onRetry(seg)}
                  disabled={retrying}
                  title="Re-translate this segment"
                >
                  <Icon
                    name={retrying ? 'loader' : 'rotate-ccw'}
                    className={retrying ? 'vt-spin' : ''}
                  />{' '}
                  {retrying ? 'RETRYING' : 'RETRY'}
                </button>
              )}
              <button
                type="button"
                className={'segment__action ' + (speaking ? 'is-open' : '')}
                onClick={() => onSpeak(seg)}
                title={speaking ? 'Stop' : 'Read aloud'}
              >
                <Icon name={speaking ? 'square' : 'volume-2'} />{' '}
                {speaking ? 'STOP' : 'SPEAK'}
              </button>
              {!readOnly && explain && (
                <button
                  type="button"
                  className={
                    'segment__action segment__action--explain ' +
                    (explain.open ? 'is-open' : '')
                  }
                  onClick={explain.onToggle}
                  aria-expanded={explain.open}
                >
                  <Icon name="book-open" /> EXPLAIN
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {explain?.open && (
        <ExplainPanel
          body={explain.body}
          isLoading={explain.isLoading}
          error={explain.error}
          onClose={explain.onToggle}
          onRetry={explain.onRetry}
        />
      )}
    </div>
  )
}

// Placeholder rendered at the top of the thread while a translation is in
// flight. Mirrors the card layout so the list doesn't jump when it lands.
export function PendingSegmentCard({
  idx,
  sourceText,
  sourceLanguage,
  targetLanguage,
  vibe,
}: {
  idx: number
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  vibe?: VibePreset
}) {
  return (
    <div className="segment segment--active segment--pending">
      <div className="segment__row">
        <div className="segment__num">{String(idx).padStart(2, '0')}</div>
        <div className="segment__src">
          <div style={eyebrow}>SOURCE · {sourceLanguage}</div>
          <div className="segment__src-text">{sourceText}</div>
        </div>
        <div className="segment__divider"></div>
        <div className="segment__tgt">
          <div style={eyebrow}>
            TARGET · {targetLanguage}
            {vibe && (
              <span style={{ color: vibe.color, marginLeft: 8 }}>
                {vibe.label}
              </span>
            )}
          </div>
          <div className="segment__tgt-text segment__pending">
            <Icon name="loader" className="vt-spin" />
            <span>Translating…</span>
          </div>
        </div>
      </div>
    </div>
  )
}
