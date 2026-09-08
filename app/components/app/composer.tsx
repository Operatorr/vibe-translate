import * as React from 'react'
import { toast } from 'sonner'

import { Icon } from '@/components/vibe-design/icon'
import type { VibePreset } from '@/components/vibe-design/design-data'
import { cssVars } from '@/lib/css-vars'
import { createRecognizer, speechRecognitionSupported, type Recognizer } from '@/lib/speech-recognition'
import { estimateTokens } from '@/lib/tokens'

const MAX_CHARS = 20_000

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
          style={{ width: `${(valueIdx / (vibes.length - 1)) * 100}%`, background: active.color }}
        ></div>
        <div className="vibe-mini__stops">
          {vibes.map((v, i) => (
            <button
              key={v.id}
              type="button"
              tabIndex={-1}
              className={'vibe-mini__dot ' + (i === valueIdx ? 'is-active' : '')}
              style={cssVars({ left: `${(i / (vibes.length - 1)) * 100}%`, '--vibe-fill': v.color })}
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
            className={'vibe-mini__label ' + (i === valueIdx ? 'is-active' : '')}
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
        onPointerUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        onBlur={(e) => onCommit(parseFloat(e.target.value))}
      />
    </div>
  </div>
)

export type ComposerHandle = { focus: () => void }

export const Composer = React.forwardRef<
  ComposerHandle,
  {
    placeholder: string
    sourceLanguage: string
    vibes: VibePreset[]
    vibeIdx: number
    onVibeChange: (idx: number) => void
    temperature: number
    onTemperatureChange: (value: number) => void
    onTemperatureCommit: (value: number) => void
    onSend: (text: string) => void
    sending: boolean
    disabled?: boolean
  }
>(function Composer(
  {
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
  },
  ref,
) {
  const [draft, setDraft] = React.useState('')
  const [interim, setInterim] = React.useState('')
  const [recording, setRecording] = React.useState(false)
  const recognizerRef = React.useRef<Recognizer | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), [])

  const stopRecording = React.useCallback(() => {
    recognizerRef.current?.stop()
    recognizerRef.current = null
    setRecording(false)
    setInterim('')
  }, [])

  React.useEffect(() => () => recognizerRef.current?.stop(), [])

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
      onFinal: (text) =>
        setDraft((d) => {
          const sep = d && !/\s$/.test(d) ? ' ' : ''
          return (d + sep + text.trim()).slice(0, MAX_CHARS)
        }),
      onEnd: () => {
        recognizerRef.current = null
        setRecording(false)
        setInterim('')
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

  const send = () => {
    const text = draft.trim()
    if (!text || sending || disabled) return
    stopRecording()
    onSend(text)
    setDraft('')
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

  const shown = interim ? `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${interim}` : draft
  const chars = shown.length
  const canSend = draft.trim().length > 0 && !sending && !disabled

  return (
    <div className="composer">
      <div className="composer__settings">
        <VibeMini vibes={vibes} valueIdx={vibeIdx} onChange={onVibeChange} />
        <TempSlider value={temperature} onChange={onTemperatureChange} onCommit={onTemperatureCommit} />
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
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="composer__field-foot">
            <span>
              {chars} chars · ~{estimateTokens(shown)} tok
              {recording && <span className="composer__rec"> · listening…</span>}
            </span>
            <div className="composer__icons">
              <button
                type="button"
                className={'composer__icon-btn ' + (recording ? 'is-active' : '')}
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
        <button
          className="composer__send"
          onClick={send}
          disabled={!canSend}
          title="Translate · Enter"
          aria-label="Translate"
        >
          <Icon name={sending ? 'loader' : 'arrow-right'} className={sending ? 'vt-spin' : ''} />
        </button>
      </div>
    </div>
  )
})
