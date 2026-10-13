import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as React from 'react'
import { toast } from 'sonner'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import { useBackButtonClose } from '@/hooks/use-back-button-close'
import type { ExplainBody, SegmentToken, VibeStop } from '@/lib/types'
import { normalizeWord, srcWordSet } from '@/lib/alignment'
import {
  READING_LABEL,
  loadReadings,
  readingScriptFor,
  type RubyPart,
} from '@/lib/readings'

import { VibeMini } from './composer'
import { ExplainPanel } from './explain-panel'
import { SegmentUsage } from './segment-usage'

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
  onDelete,
  deleting,
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
  // The Character's stop; preselected on Retry for a legacy null-vibe row.
  defaultVibe?: VibeStop
  onExpand: (id: string) => void
  explain?: SegmentExplainState
  onCopy: (seg: SegmentView) => void
  onRetry?: (seg: SegmentView, vibe: VibeStop) => void
  retrying?: boolean
  onDelete?: (seg: SegmentView) => void
  deleting?: boolean
  onSpeak: (seg: SegmentView) => void
  speaking?: boolean
  readOnly?: boolean
}) {
  // Hover-align state lives per card so hovering a token re-renders only this
  // card, not the whole shell.
  const [selection, setSelection] = React.useState<Selection>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const vibe = vibes.find((v) => v.id === seg.vibe)
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

  const reading = useReadings(tokens, targetLanguage)

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
        <div className="segment__num">
          {!readOnly && onDelete ? (
            <SegmentNumberMenu
              idx={idx}
              disabled={retrying || deleting}
              onDelete={() => onDelete(seg)}
            />
          ) : (
            String(idx).padStart(2, '0')
          )}
        </div>

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
              <span style={{ color: vibe?.color, marginLeft: 8 }}>
                {vibe?.label ?? 'Vibe not recorded'}
              </span>
            </div>
            {!readOnly && <SegmentUsage usage={seg.tokenUsage} />}
          </div>
          <div
            className={
              'segment__tgt-text ' +
              (isJa ? 'segment__tgt-text--ja ' : '') +
              (reading.parts ? 'segment__tgt-text--reading' : '')
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
                {reading.parts ? <Ruby parts={reading.parts[i]} /> : p.t}
              </span>
            ))}
          </div>
          <div className="segment__tgt-row">
            <div className="segment__actions">
              <TranslationDisplay
                text={seg.targetText}
                language={targetLanguage}
              />
              <button
                type="button"
                className="segment__action segment__action--icon"
                onClick={() => onCopy(seg)}
                title="Copy translation"
                aria-label="Copy translation"
              >
                <Icon name="copy" />
              </button>
              {!readOnly && onRetry && (
                <RetryDialog
                  vibes={vibes}
                  current={seg.vibe ?? defaultVibe}
                  retrying={retrying}
                  onConfirm={(next) => onRetry(seg, next)}
                />
              )}
              <button
                type="button"
                className={
                  'segment__action segment__action--icon ' +
                  (speaking ? 'is-open' : '')
                }
                onClick={() => onSpeak(seg)}
                title={speaking ? 'Stop' : 'Read aloud'}
                aria-label={speaking ? 'Stop' : 'Read aloud'}
              >
                <Icon name={speaking ? 'square' : 'volume-2'} />
              </button>
              {reading.script && (
                <button
                  type="button"
                  className={
                    'segment__action segment__action--icon ' +
                    (reading.on ? 'is-open' : '')
                  }
                  onClick={reading.toggle}
                  title={`${reading.on ? 'Hide' : 'Show'} ${reading.label}`}
                  aria-label={reading.label}
                  aria-pressed={reading.on}
                >
                  {reading.loading ? (
                    <Icon name="loader" className="vt-spin" />
                  ) : (
                    <span className="segment__action-glyph" aria-hidden="true">
                      {reading.script === 'kana' ? 'あ' : 'ā'}
                    </span>
                  )}
                </button>
              )}
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

// Pinyin/Kana over the target text, off by default so the learner tries to
// read it first. Readings are generated client-side on the first toggle and
// recomputed when a retry replaces the tokens.
function useReadings(tokens: SegmentToken[], language: string) {
  const script = readingScriptFor(language)
  const label = script ? READING_LABEL[script] : ''
  const [on, setOn] = React.useState(false)
  const [loaded, setLoaded] = React.useState<{
    tokens: SegmentToken[]
    parts: RubyPart[][]
  } | null>(null)
  const parts = on && loaded?.tokens === tokens ? loaded.parts : null

  React.useEffect(() => {
    if (!on || loaded?.tokens === tokens) return
    let live = true
    loadReadings(
      tokens.map((tok) => tok.t),
      language,
    ).then(
      (next) => {
        if (live) setLoaded({ tokens, parts: next })
      },
      (error: unknown) => {
        if (!live) return
        console.error(error)
        setOn(false)
        toast.error(`Could not load ${label}.`)
      },
    )
    return () => {
      live = false
    }
  }, [on, tokens, loaded, language, label])

  return {
    script,
    label,
    on,
    parts,
    loading: on && !parts,
    toggle: () => setOn((curr) => !curr),
  }
}

function Ruby({ parts }: { parts: RubyPart[] }) {
  return parts.map((part, i) =>
    part.rt ? (
      <ruby key={i}>
        {part.base}
        <rt>{part.rt}</rt>
      </ruby>
    ) : (
      <React.Fragment key={i}>{part.base}</React.Fragment>
    ),
  )
}

// The segment number doubles as the trigger for per-Segment actions. Radix
// DropdownMenu supplies menu semantics, roving focus, and focus return.
function SegmentNumberMenu({
  idx,
  disabled,
  onDelete,
}: {
  idx: number
  disabled?: boolean
  onDelete: () => void
}) {
  const label = String(idx).padStart(2, '0')
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="segment__num-btn"
          title="Segment options"
          aria-label={`Segment ${label} options`}
        >
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="vt-popover vt-menu"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <DropdownMenu.Item
            className="vt-menu__item vt-menu__item--danger"
            disabled={disabled}
            onSelect={onDelete}
          >
            <Icon name="trash" /> Delete segment
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// Retry asks for the Vibe stop first, opened at the Segment's current stop:
// confirming unchanged re-samples, moving the slider re-translates at the new
// stop. Either way the Segment is overwritten in place. Back-aware like the
// full-screen display.
function RetryDialog({
  vibes,
  current,
  retrying,
  onConfirm,
}: {
  vibes: VibePreset[]
  current: VibeStop | undefined
  retrying?: boolean
  onConfirm: (vibe: VibeStop) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [idx, setIdx] = React.useState(0)
  useBackButtonClose(open, () => setOpen(false))
  const onOpenChange = (next: boolean) => {
    // Every open starts from the stop the Segment was translated at.
    if (next)
      setIdx(
        Math.max(
          0,
          vibes.findIndex((v) => v.id === current),
        ),
      )
    setOpen(next)
  }
  const picked = vibes[idx]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={
            'segment__action segment__action--icon ' +
            (retrying ? 'is-busy' : '')
          }
          disabled={retrying || vibes.length === 0}
          title="Re-translate this segment"
          aria-label={retrying ? 'Retrying translation' : 'Retry translation'}
        >
          <Icon
            name={retrying ? 'loader' : 'rotate-ccw'}
            className={retrying ? 'vt-spin' : ''}
          />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="retry-modal__overlay" />
        <Dialog.Content
          className="retry-modal"
          onOpenAutoFocus={(event) => {
            // Land on the slider so arrow keys move the stop straight away.
            const slider = (
              event.currentTarget as HTMLElement | null
            )?.querySelector<HTMLElement>('[role="slider"]')
            if (slider) {
              event.preventDefault()
              slider.focus()
            }
          }}
        >
          <span className="vt-eyebrow">RETRY TRANSLATION</span>
          <Dialog.Title className="retry-modal__title">
            Pick a vibe stop
          </Dialog.Title>
          <Dialog.Description className="retry-modal__description">
            Keep the current stop for a fresh take, or move it to re-translate
            in a different register. This replaces the current translation.
          </Dialog.Description>
          <VibeMini vibes={vibes} valueIdx={idx} onChange={setIdx} />
          <div className="retry-modal__actions">
            <Dialog.Close asChild>
              <button type="button" className="vt-btn vt-btn--ghost">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="vt-btn vt-btn--primary"
              disabled={!picked}
              onClick={() => {
                if (!picked) return
                setOpen(false)
                onConfirm(picked.id as VibeStop)
              }}
            >
              <Icon name="rotate-ccw" /> Confirm
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Full-screen target text. Its open state is controlled so Back closes it
// first (without changing the mobile pane or leaving the route); Radix
// returns focus to the trigger on every close.
function TranslationDisplay({
  text,
  language,
}: {
  text: string
  language: string
}) {
  const [open, setOpen] = React.useState(false)
  useBackButtonClose(open, () => setOpen(false))
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="segment__action segment__action--icon"
          title="Show translation full screen"
          aria-label="Show translation full screen"
        >
          <Icon name="expand" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="translation-display__overlay" />
        <Dialog.Content
          className="translation-display"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Translation display</Dialog.Title>
          <Dialog.Close asChild>
            <button
              type="button"
              className="translation-display__close"
              title="Close translation display"
              aria-label="Close translation display"
            >
              <Icon name="x" />
            </button>
          </Dialog.Close>
          <div className="translation-display__text" lang={language}>
            {text}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
