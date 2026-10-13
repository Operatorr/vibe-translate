import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as React from 'react'
import { toast } from 'sonner'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import { useBackButtonClose } from '@/hooks/use-back-button-close'
import type {
  ExplainBody,
  Perspective,
  SegmentToken,
  VibeStop,
} from '@/lib/types'
import { normalizeWord, srcWordSet } from '@/lib/alignment'
import { perspectiveTag } from '@/lib/character-options'
import {
  READING_LABEL,
  loadReadings,
  readingScriptFor,
  type RubyPart,
} from '@/lib/readings'

import { PerspectiveRadios, TempSlider, VibeMini } from './composer'
import { ExplainPanel } from './explain-panel'
import { SegmentUsage } from './segment-usage'

export type SegmentView = {
  id: string
  sourceText: string
  targetText: string
  vibe: VibeStop | null
  perspective?: Perspective | null
  tokenAlignment: SegmentToken[]
  tokenUsage?: Record<string, unknown>
  createdAt: string
}

// What Retry re-translates at: the values the dialog shows at Confirm.
export type RetryChoice = {
  vibe: VibeStop
  perspective: Perspective
  temperature: number
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
  defaultPerspective,
  defaultTemperature,
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
  // The Character's perspective; preselected on Retry for a legacy row.
  defaultPerspective?: Perspective
  // The Character's temperature; Segments don't record one, so Retry opens
  // here.
  defaultTemperature?: number
  onExpand: (id: string) => void
  explain?: SegmentExplainState
  onCopy: (seg: SegmentView) => void
  onRetry?: (seg: SegmentView, choice: RetryChoice) => void
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
  const perspective = perspectiveTag(seg.perspective)
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
            <div
              className="segment__src-text"
              lang={sourceLanguage}
              onPointerLeave={clearHover}
            >
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
              <span style={{ color: vibe?.color }}>
                {vibe?.label ?? 'Vibe not recorded'}
                {perspective && ` · ${perspective}`}
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
                reading={reading}
                onSpeak={() => onSpeak(seg)}
                speaking={speaking}
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
                  currentVibe={seg.vibe ?? defaultVibe}
                  currentPerspective={
                    seg.perspective ?? defaultPerspective ?? 'to'
                  }
                  currentTemperature={defaultTemperature ?? 0.4}
                  retrying={retrying}
                  onConfirm={(choice) => onRetry(seg, choice)}
                />
              )}
              <SpeakButton onSpeak={() => onSpeak(seg)} speaking={speaking} />
              <ReadingButton reading={reading} />
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
// recomputed when a retry replaces the tokens or the Character's target
// language changes (the card stays mounted with the same tokens).
function useReadings(tokens: SegmentToken[], language: string) {
  const script = readingScriptFor(language)
  const label = script ? READING_LABEL[script] : ''
  const [on, setOn] = React.useState(false)
  const [loaded, setLoaded] = React.useState<{
    tokens: SegmentToken[]
    language: string
    parts: RubyPart[][]
  } | null>(null)
  const active = on && script !== null
  const fresh = loaded?.tokens === tokens && loaded.language === language
  const parts = active && fresh ? loaded.parts : null

  React.useEffect(() => {
    if (!active || fresh) return
    let live = true
    loadReadings(
      tokens.map((tok) => tok.t),
      language,
    ).then(
      (next) => {
        if (live) setLoaded({ tokens, language, parts: next })
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
  }, [active, fresh, tokens, language, label])

  return {
    script,
    label,
    on: active,
    parts,
    loading: active && !parts,
    toggle: () => setOn((curr) => !curr),
  }
}

function SpeakButton({
  onSpeak,
  speaking,
}: {
  onSpeak: () => void
  speaking?: boolean
}) {
  return (
    <button
      type="button"
      className={
        'segment__action segment__action--icon ' + (speaking ? 'is-open' : '')
      }
      onClick={onSpeak}
      title={speaking ? 'Stop' : 'Read aloud'}
      aria-label={speaking ? 'Stop' : 'Read aloud'}
    >
      <Icon name={speaking ? 'square' : 'volume-2'} />
    </button>
  )
}

function ReadingButton({
  reading,
}: {
  reading: ReturnType<typeof useReadings>
}) {
  if (!reading.script) return null
  return (
    <>
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
        aria-busy={reading.loading}
      >
        {reading.loading ? (
          <Icon name="loader" className="vt-spin" />
        ) : (
          <span className="segment__action-glyph" aria-hidden="true">
            {reading.script === 'kana' ? 'あ' : 'ā'}
          </span>
        )}
      </button>
      <span className="sr-only" role="status">
        {reading.loading
          ? `Loading ${reading.label}…`
          : reading.parts
            ? `${reading.label} shown`
            : ''}
      </span>
    </>
  )
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

// Retry asks for the Vibe stop, temperature and Perspective first, opened at
// the Segment's stop and perspective and the Character's temperature:
// confirming unchanged re-samples, changing any of them re-translates with
// the new values. Either way the Segment is overwritten in place, and the
// Character's own settings are untouched. Back-aware like the full-screen
// display.
function RetryDialog({
  vibes,
  currentVibe,
  currentPerspective,
  currentTemperature,
  retrying,
  onConfirm,
}: {
  vibes: VibePreset[]
  currentVibe: VibeStop | undefined
  currentPerspective: Perspective
  currentTemperature: number
  retrying?: boolean
  onConfirm: (choice: RetryChoice) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [idx, setIdx] = React.useState(0)
  const [perspective, setPerspective] = React.useState(currentPerspective)
  const [temperature, setTemperature] = React.useState(currentTemperature)
  useBackButtonClose(open, () => setOpen(false))
  const onOpenChange = (next: boolean) => {
    // Every open starts from the Segment's stop and perspective and the
    // Character's temperature.
    if (next) {
      setIdx(
        Math.max(
          0,
          vibes.findIndex((v) => v.id === currentVibe),
        ),
      )
      setPerspective(currentPerspective)
      setTemperature(currentTemperature)
    }
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
            Retry translation settings
          </Dialog.Title>
          <Dialog.Description className="retry-modal__description">
            Keep the current settings for a fresh take, or change them to
            re-translate in a different register. This replaces the current
            translation.
          </Dialog.Description>
          <div className="retry-modal__settings">
            <VibeMini vibes={vibes} valueIdx={idx} onChange={setIdx} />
            <TempSlider value={temperature} onChange={setTemperature} />
            <PerspectiveRadios
              value={perspective}
              onChange={setPerspective}
              nestedHelp
            />
          </div>
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
                onConfirm({
                  vibe: picked.id as VibeStop,
                  perspective,
                  temperature: Math.round(temperature * 100) / 100,
                })
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
  reading,
  onSpeak,
  speaking,
}: {
  text: string
  language: string
  reading: ReturnType<typeof useReadings>
  onSpeak: () => void
  speaking?: boolean
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
          <div className="translation-display__controls">
            <ReadingButton reading={reading} />
            <SpeakButton onSpeak={onSpeak} speaking={speaking} />
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
          </div>
          <div
            className={
              'translation-display__text ' +
              (reading.parts ? 'translation-display__text--reading' : '')
            }
            lang={language}
          >
            {reading.parts
              ? reading.parts.map((parts, i) => <Ruby key={i} parts={parts} />)
              : text}
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
  vibe,
  perspective,
}: {
  idx: number
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  vibe?: VibePreset
  perspective?: Perspective
}) {
  const tag = perspectiveTag(perspective)
  return (
    <div className="segment segment--active segment--pending">
      <div className="segment__row">
        <div className="segment__num">{String(idx).padStart(2, '0')}</div>
        <div className="segment__src">
          <div className="segment__src-text" lang={sourceLanguage}>
            {sourceText}
          </div>
        </div>
        <div className="segment__divider"></div>
        <div className="segment__tgt">
          <div style={eyebrow}>
            {vibe && (
              <span style={{ color: vibe.color }}>
                {vibe.label}
                {tag && ` · ${tag}`}
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
