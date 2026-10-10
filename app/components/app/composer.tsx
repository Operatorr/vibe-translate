import * as React from 'react'
import { toast } from 'sonner'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import { cssVars } from '@/lib/css-vars'
import { readDrafts, writeDrafts, type Drafts } from '@/lib/draft-store'
import {
  createRecognizer,
  speechRecognitionSupported,
  type Recognizer,
} from '@/lib/speech-recognition'
import { estimateTokens } from '@/lib/tokens'

const MAX_CHARS = 20_000

// Append a dictated phrase to the draft with a single separating space.
function joinDraft(draft: string, text: string): string {
  const next = text.trim()
  if (!next) return draft
  const sep = draft && !/\s$/.test(draft) ? ' ' : ''
  return (draft + sep + next).slice(0, MAX_CHARS)
}

export const VibeMini = ({
  vibes,
  valueIdx,
  onChange,
}: {
  vibes: VibePreset[]
  valueIdx: number
  onChange: (value: number) => void
}) => {
  const active = vibes[valueIdx] || vibes[0]
  // Fraction along the rail; a single-stop list would otherwise divide by 0.
  const at = (i: number) => (vibes.length > 1 ? i / (vibes.length - 1) : 0)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(Math.min(vibes.length - 1, valueIdx + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(Math.max(0, valueIdx - 1))
    } else if (e.key === 'Home') {
      onChange(0)
    } else if (e.key === 'End') {
      onChange(vibes.length - 1)
    }
  }
  return (
    <div className="vibe-mini">
      <div className="vibe-mini__head">
        <span className="vibe-mini__head-l">VIBE · {vibes.length} STOPS</span>
        <span className="vibe-mini__head-r" style={{ color: active.color }}>
          {active.label} · {active.hint}
        </span>
      </div>
      <div
        className="vibe-mini__rail-wrap"
        role="slider"
        tabIndex={0}
        aria-label="Vibe"
        aria-valuemin={0}
        aria-valuemax={vibes.length - 1}
        aria-valuenow={valueIdx}
        aria-valuetext={active.label}
        onKeyDown={onKey}
      >
        <div className="vibe-mini__rail"></div>
        <div
          className="vibe-mini__fill"
          style={{ width: `${at(valueIdx) * 100}%`, background: active.color }}
        ></div>
        <div className="vibe-mini__stops">
          {vibes.map((v, i) => (
            <button
              type="button"
              key={v.id}
              tabIndex={-1}
              className={
                'vibe-mini__dot ' + (i === valueIdx ? 'is-active' : '')
              }
              style={cssVars({
                left: `${at(i) * 100}%`,
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
          <button
            key={v.id}
            type="button"
            tabIndex={-1}
            className={
              'vibe-mini__label ' + (i === valueIdx ? 'is-active' : '')
            }
            onClick={() => onChange(i)}
            style={{ color: i === valueIdx ? v.color : undefined }}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export const TempSlider = ({
  value,
  onChange,
  onCommit,
}: {
  value: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
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
        aria-label="Temperature"
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={(e) =>
          onCommit(parseFloat((e.target as HTMLInputElement).value))
        }
        onKeyUp={(e) =>
          onCommit(parseFloat((e.target as HTMLInputElement).value))
        }
        onBlur={(e) => onCommit(parseFloat(e.target.value))}
      />
    </div>
  </div>
)

export type ComposerHandle = { focus: () => void }

export const Composer = React.forwardRef<
  ComposerHandle,
  {
    contextId: string
    placeholder: string
    sourceLanguage: string
    vibes: VibePreset[]
    vibeIdx: number
    onVibeChange: (idx: number) => void
    temperature: number
    onTemperatureChange: (value: number) => void
    onTemperatureCommit: (value: number) => void
    // Resolves true once the translation landed; the draft is cleared only then.
    onSend: (text: string) => Promise<boolean>
    sending: boolean
    disabled?: boolean
    // Account whose drafts persist in sessionStorage (see draft-store.ts);
    // without one, drafts live in memory only.
    draftOwner?: string | null
  }
>(function Composer(
  {
    contextId,
    placeholder,
    sourceLanguage,
    vibes,
    vibeIdx,
    onVibeChange,
    temperature,
    onTemperatureChange,
    onTemperatureCommit,
    onSend,
    sending,
    disabled,
    draftOwner,
  },
  ref,
) {
  // Switching threads keeps each draft, and a completion clears only the draft
  // it submitted. One pending send must not lock the next thread's composer.
  // Drafts persist per account, so following a recovery link (or checkout)
  // and coming back restores them; an account change swaps in that account's
  // drafts during render, so another account's text is never shown.
  const owner = draftOwner ?? null
  const [store, setStore] = React.useState(() => ({
    owner,
    drafts: owner ? readDrafts(owner) : ({} as Drafts),
  }))
  let current = store
  if (store.owner !== owner) {
    current = { owner, drafts: owner ? readDrafts(owner) : {} }
    setStore(current)
  }
  const draft = current.drafts[contextId] ?? ''
  const setDraft = React.useCallback(
    (update: React.SetStateAction<string>) => {
      setStore((prev) => {
        // A late completion must not write into the next account's drafts.
        if (prev.owner !== owner) return prev
        const before = prev.drafts[contextId] ?? ''
        const next = typeof update === 'function' ? update(before) : update
        if (next === before) return prev
        return { owner, drafts: { ...prev.drafts, [contextId]: next } }
      })
    },
    [contextId, owner],
  )
  React.useEffect(() => {
    if (store.owner) writeDrafts(store.owner, store.drafts)
  }, [store])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const settingsId = React.useId()
  const settingsRef = React.useRef<HTMLDivElement>(null)
  // Set when the toggle is activated from the keyboard; the drawer precedes
  // the toggle in DOM order, so forward Tab would never reach its controls.
  const focusSettings = React.useRef(false)
  React.useEffect(() => {
    if (!settingsOpen || !focusSettings.current) return
    // Wait a frame: the drawer must be un-inert and visible to take focus.
    const frame = requestAnimationFrame(() => {
      focusSettings.current = false
      settingsRef.current
        ?.querySelector<HTMLElement>('[role="slider"]')
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [settingsOpen])
  const [interim, setInterimState] = React.useState('')
  const [recording, setRecording] = React.useState(false)
  const recognizerRef = React.useRef<Recognizer | null>(null)
  // Mirrors `interim` so stop/send can read the latest value synchronously.
  const interimRef = React.useRef('')
  const inFlightRef = React.useRef(new Set<string>())
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useImperativeHandle(
    ref,
    () => ({ focus: () => textareaRef.current?.focus() }),
    [],
  )

  const setInterim = React.useCallback((text: string) => {
    interimRef.current = text
    setInterimState(text)
  }, [])

  // Commit still-interim dictation into the draft. The engine often ends with
  // words it never finalized; the user saw them, so they must not vanish.
  const flushInterim = React.useCallback(() => {
    const pending = interimRef.current
    setInterim('')
    if (pending.trim()) setDraft((d) => joinDraft(d, pending))
  }, [setInterim, setDraft])

  // Abort (not stop): stop() would deliver a late final result after we've
  // already flushed the interim text, duplicating it or writing into the next
  // draft. abort() also detaches every handler.
  const stopRecording = React.useCallback(() => {
    recognizerRef.current?.abort()
    recognizerRef.current = null
    setRecording(false)
    flushInterim()
  }, [flushInterim])

  // Flush the previous thread's dictation before the next thread uses the mic.
  React.useEffect(() => () => stopRecording(), [stopRecording])

  const toggleRecording = () => {
    if (recording) {
      stopRecording()
      return
    }
    if (!speechRecognitionSupported()) {
      toast.error('Voice dictation needs Chrome, Edge or Safari.')
      return
    }
    const rec = createRecognizer({
      languageCode: sourceLanguage,
      onInterim: setInterim,
      onFinal: (text) => setDraft((d) => joinDraft(d, text)),
      onEnd: () => {
        recognizerRef.current = null
        setRecording(false)
        flushInterim()
      },
      onError: (message) => {
        toast.error(message)
        stopRecording()
      },
    })
    if (!rec) return
    recognizerRef.current = rec
    try {
      rec.start()
      setRecording(true)
    } catch {
      toast.error('Could not start the microphone.')
      recognizerRef.current = null
    }
  }

  const send = async () => {
    if (sending || disabled || inFlightRef.current.has(contextId)) return
    const text = joinDraft(draft, interimRef.current).trim()
    if (!text) return
    stopRecording()
    inFlightRef.current.add(contextId)
    try {
      const ok = await onSend(text)
      // Clear only once the translation landed — a 402/timeout keeps the source
      // for a retry — and only if the user hasn't typed more in the meantime.
      if (!ok) return
      setDraft((d) => (d.trim() === text ? '' : d))
      // Also clear the stored copy directly: if this composer unmounted while
      // the send was in flight, the state update above never persists.
      if (owner) {
        const stored = readDrafts(owner)
        if (stored[contextId]?.trim() === text)
          writeDrafts(owner, { ...stored, [contextId]: '' })
      }
    } finally {
      inFlightRef.current.delete(contextId)
    }
  }

  const onAttach = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 512 * 1024) {
      toast.error('Attach a text file under 512 KB.')
      return
    }
    try {
      const text = (await file.text()).replace(/\r\n/g, '\n').trim()
      if (!text) {
        toast.error('That file has no readable text.')
        return
      }
      setDraft((d) => (d ? `${d}\n\n${text}` : text).slice(0, MAX_CHARS))
      toast.success(`Attached ${file.name}`)
      textareaRef.current?.focus()
    } catch {
      toast.error('Could not read that file.')
    }
  }

  // Wrap the selection in backticks (or insert a code fence when nothing is
  // selected) so the model keeps code verbatim — see the translate prompt.
  const insertCode = () => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = draft.slice(start, end)
    const wrapped = selected
      ? selected.includes('\n')
        ? `\n\`\`\`\n${selected}\n\`\`\`\n`
        : `\`${selected}\``
      : '``'
    const next = draft.slice(0, start) + wrapped + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = selected ? start + wrapped.length : start + 1
      el.setSelectionRange(caret, caret)
    })
  }

  const shown = interim
    ? `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${interim}`
    : draft
  const chars = shown.length
  const canSend = shown.trim().length > 0 && !sending && !disabled
  const activeVibe = vibes[vibeIdx] ?? vibes[0]
  const settingsLabel = activeVibe
    ? `Vibe and temperature · ${activeVibe.label}`
    : 'Vibe and temperature'

  return (
    <div className="composer">
      <div
        ref={settingsRef}
        className="composer__settings-drawer"
        data-open={settingsOpen}
        id={settingsId}
        inert={!settingsOpen}
        aria-hidden={!settingsOpen}
      >
        <div className="composer__settings-clip">
          <div className="composer__settings">
            <VibeMini
              vibes={vibes}
              valueIdx={vibeIdx}
              onChange={onVibeChange}
            />
            <TempSlider
              value={temperature}
              onChange={onTemperatureChange}
              onCommit={onTemperatureCommit}
            />
          </div>
        </div>
      </div>
      <div className="composer__row">
        <div className={'composer__field ' + (recording ? 'is-recording' : '')}>
          <textarea
            ref={textareaRef}
            className="composer__textarea"
            placeholder={placeholder}
            value={shown}
            maxLength={MAX_CHARS}
            disabled={disabled}
            onChange={(e) => {
              setInterim('')
              setDraft(e.target.value)
            }}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="composer__field-foot">
            <span>
              {chars} chars · ~{estimateTokens(shown)} tok
              {recording && (
                <span className="composer__rec"> · listening…</span>
              )}
            </span>
            <div className="composer__icons">
              <button
                type="button"
                className={
                  'composer__icon-btn ' + (recording ? 'is-active' : '')
                }
                title={recording ? 'Stop dictation' : 'Voice dictate'}
                aria-pressed={recording}
                onClick={toggleRecording}
              >
                <Icon name={recording ? 'mic-off' : 'mic'} />
              </button>
              <button
                type="button"
                className="composer__icon-btn"
                title="Attach a text file"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="paperclip" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown,.srt,.csv,.json,text/*"
                hidden
                onChange={(e) => {
                  void onAttach(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="composer__icon-btn"
                title="Mark as code (kept verbatim)"
                onClick={insertCode}
              >
                <Icon name="braces" />
              </button>
            </div>
          </div>
        </div>
        <div className="composer__buttons">
          <button
            type="button"
            className="composer__settings-toggle"
            aria-label={settingsLabel}
            title={settingsLabel}
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            onClick={(event) => {
              // detail 0: Enter/Space, not a pointer click.
              focusSettings.current = !settingsOpen && event.detail === 0
              setSettingsOpen(!settingsOpen)
            }}
          >
            <Icon name="sliders-horizontal" />
            {activeVibe && (
              <span
                className="composer__settings-vibe"
                style={{ background: activeVibe.color }}
                aria-hidden
              />
            )}
          </button>
          <button
            type="button"
            className="composer__send"
            onClick={() => void send()}
            disabled={!canSend}
            title="Translate · Enter"
            aria-label="Translate"
          >
            <Icon
              name={sending ? 'loader' : 'arrow-right'}
              className={sending ? 'vt-spin' : ''}
            />
          </button>
        </div>
      </div>
    </div>
  )
})
