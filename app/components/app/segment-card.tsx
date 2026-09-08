import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import type { ExplainBody, SegmentToken, VibeStop } from '@/lib/types'

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

function tokenMeta(seg: SegmentView): string {
  const usage = seg.tokenUsage ?? {}
  const completion = Number(usage.completionTokens)
  if (Number.isFinite(completion) && completion > 0) return `${completion} tok`
  return 'cached · 0 cr'
}

// Words on the source side light up when the hovered target token's `src`
// span contains them. Punctuation-only tokens never match.
function sourceIsPaired(word: string, hovered: SegmentToken | null): boolean {
  if (!hovered?.src) return false
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  if (!w) return false
  return hovered.src.toLowerCase().includes(w)
}

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
  hoveredTok,
  onHoverTok,
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
  hoveredTok: { segId: string; token: SegmentToken } | null
  onHoverTok: (value: { segId: string; token: SegmentToken } | null) => void
  onCopy: (seg: SegmentView) => void
  onRetry?: (seg: SegmentView) => void
  retrying?: boolean
  onSpeak: (seg: SegmentView) => void
  speaking?: boolean
  readOnly?: boolean
}) {
  const hovered = hoveredTok?.segId === seg.id ? hoveredTok.token : null
  const vibe = vibes.find((v) => v.id === (seg.vibe ?? defaultVibe))
  const isJa = targetLanguage.toLowerCase().startsWith('ja')
  const tokens =
    seg.tokenAlignment.length > 0 ? seg.tokenAlignment : [{ t: seg.targetText, src: seg.sourceText }]

  return (
    <div
      className={
        'segment ' + (isActive ? 'segment--active ' : '') + (collapsed ? 'segment--collapsed' : '')
      }
      id={`segment-${seg.id}`}
    >
      <div className="segment__row">
        <div className="segment__num">{String(idx).padStart(2, '0')}</div>

        {collapsed ? (
          <div className="segment__src is-collapsed">
            <button
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
            <div className="segment__src-text">
              {seg.sourceText.split(/(\s+)/).map((w, i) => {
                if (!w.trim()) return w
                return (
                  <span key={i} className={'tok ' + (sourceIsPaired(w, hovered) ? 'is-paired' : '')}>
                    {w}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {!collapsed && <div className="segment__divider"></div>}

        <div className="segment__tgt">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={eyebrow}>
              TARGET · {targetLanguage}
              {vibe && (
                <span style={{ color: vibe.color, marginLeft: 8 }}>{vibe.label}</span>
              )}
            </div>
            {!readOnly && <div className="segment__tgt-meta">{tokenMeta(seg)}</div>}
          </div>
          <div
            className={'segment__tgt-text ' + (isJa ? 'segment__tgt-text--ja' : '')}
            onMouseLeave={() => onHoverTok(null)}
          >
            {tokens.map((p, i) => {
              const paired = hovered != null && hovered === p
              return (
                <span
                  key={i}
                  className={'tok ' + (paired ? 'is-paired' : '')}
                  onMouseEnter={() => onHoverTok({ segId: seg.id, token: p })}
                  onClick={() => onHoverTok(paired ? null : { segId: seg.id, token: p })}
                  title={p.src ? `↔ ${p.src}` : ''}
                >
                  {p.t}
                </span>
              )
            })}
          </div>
          <div className="segment__tgt-row">
            <div className="segment__actions">
              <button className="segment__action" onClick={() => onCopy(seg)} title="Copy translation">
                <Icon name="copy" /> COPY
              </button>
              {!readOnly && onRetry && (
                <button
                  className={'segment__action ' + (retrying ? 'is-busy' : '')}
                  onClick={() => onRetry(seg)}
                  disabled={retrying}
                  title="Re-translate this segment"
                >
                  <Icon name={retrying ? 'loader' : 'rotate-ccw'} className={retrying ? 'vt-spin' : ''} />{' '}
                  {retrying ? 'RETRYING' : 'RETRY'}
                </button>
              )}
              <button
                className={'segment__action ' + (speaking ? 'is-open' : '')}
                onClick={() => onSpeak(seg)}
                title={speaking ? 'Stop' : 'Read aloud'}
              >
                <Icon name={speaking ? 'square' : 'volume-2'} /> {speaking ? 'STOP' : 'SPEAK'}
              </button>
              {!readOnly && explain && (
                <button
                  className={'segment__action segment__action--explain ' + (explain.open ? 'is-open' : '')}
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
            {vibe && <span style={{ color: vibe.color, marginLeft: 8 }}>{vibe.label}</span>}
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
