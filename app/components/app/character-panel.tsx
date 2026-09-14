import * as React from 'react'

import { Icon } from '@/components/vibe-design/icon'
import {
  LANG_NAME,
  getVibesForLang,
} from '@/components/vibe-design/design-data'
import type { CharacterInput } from '@/hooks/use-app-data'
import { initialsFor } from '@/lib/initials'
import { characterFormSchema } from '@/lib/schemas'
import { compileSystemPrompt } from '@/lib/system-prompt'
import type { Character, VibeStop } from '@/lib/types'

const LANGUAGE_NAMES = LANG_NAME as Record<string, string>
const LANGUAGE_CODES = Object.keys(LANGUAGE_NAMES)

const TONE_OPTIONS = [
  'warm',
  'dry',
  'playful',
  'stern',
  'ceremonial',
  'gentle',
  'brisk',
]
// Slider position that means "no verbosity guidance" (omitted from the persona).
const DEFAULT_VERBOSITY = 0.4
const REGION_SUGGESTIONS = [
  'Tokyo',
  'Osaka',
  'Kyoto',
  'Hokkaido',
  'Okinawa',
  'Imperial Court',
  'Seoul',
  'São Paulo',
  'Paris',
  'Berlin',
  'Madrid',
  'Beijing',
]
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
const COLORS = [
  'var(--magenta-400)',
  'var(--cyan-400)',
  'var(--orange-400)',
  'var(--turq-400)',
  'var(--blue-400)',
  'var(--amber-400)',
  'var(--red-400)',
]

type Draft = {
  name: string
  age: string
  region: string
  formality: string
  tone: string
  verbosity: number
  temperature: number
  traits: Set<string>
  sourceLanguage: string
  targetLanguage: string
  defaultVibe: VibeStop
  color: string
  instructions: string
}

function draftFrom(char: Character | null): Draft {
  return {
    name: char?.name ?? '',
    age: char?.persona.age ?? '',
    region: char?.persona.region ?? '',
    formality: char?.persona.formality ?? '',
    tone: char?.persona.tone ?? '',
    verbosity: char?.persona.verbosity ?? DEFAULT_VERBOSITY,
    temperature: char?.temperature ?? 0.4,
    traits: new Set(char?.persona.traits ?? []),
    sourceLanguage: char?.sourceLanguage ?? 'en-US',
    targetLanguage: char?.targetLanguage ?? 'ja-JP',
    defaultVibe: char?.defaultVibe ?? 'casual',
    color: char?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    instructions: char?.instructions ?? '',
  }
}

function toInput(d: Draft): CharacterInput {
  const persona: CharacterInput['persona'] = { traits: Array.from(d.traits) }
  if (d.age.trim()) persona.age = d.age.trim()
  if (d.region.trim()) persona.region = d.region.trim()
  if (d.formality.trim()) persona.formality = d.formality.trim()
  if (d.tone.trim()) persona.tone = d.tone.trim()
  // Voice fields are persona: any value makes the Character non-canonical and
  // keeps it out of the shared translation cache (adr/0004). So "Neutral" tone
  // and the default verbosity are omitted rather than written as a value.
  if (Math.abs(d.verbosity - DEFAULT_VERBOSITY) > 0.001)
    persona.verbosity = Math.round(d.verbosity * 100) / 100
  return {
    name: d.name.trim(),
    initials: initialsFor(d.name),
    color: d.color,
    sourceLanguage: d.sourceLanguage,
    targetLanguage: d.targetLanguage,
    defaultVibe: d.defaultVibe,
    temperature: Math.round(d.temperature * 100) / 100,
    persona,
    instructions: d.instructions.trim() || undefined,
  }
}

const Slider = ({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (v: number) => void
  label: string
}) => (
  <div className="cust__slider-wrap">
    <div className="cust__slider-track">
      <div className="cust__slider-rail"></div>
      <div
        className="cust__slider-fill"
        style={{ width: `${value * 100}%` }}
      ></div>
      <div
        className="cust__slider-thumb"
        style={{ left: `${value * 100}%` }}
      ></div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          width: '100%',
          cursor: 'pointer',
        }}
      />
    </div>
    <span className="cust__slider-val">{value.toFixed(2)}</span>
  </div>
)

export function CharacterPanel({
  character,
  onClose,
  onSave,
  onDelete,
  saving,
}: {
  // null → create mode
  character: Character | null
  onClose: () => void
  onSave: (input: CharacterInput) => Promise<void> | void
  onDelete?: () => void
  saving: boolean
}) {
  const [d, setD] = React.useState<Draft>(() => draftFrom(character))
  const [error, setError] = React.useState<string | null>(null)
  // Deleting cascades to every Thread and Segment, so it takes typing the
  // Character's name rather than a one-tap browser confirm.
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [confirmName, setConfirmName] = React.useState('')
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))
  const vibes = getVibesForLang(d.targetLanguage)
  const isCreate = character === null

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const input = toInput(d)
  const sysprompt = compileSystemPrompt({
    name: input.name,
    // BCP-47 codes, exactly as the worker's translate prompt receives them.
    sourceLanguage: d.sourceLanguage,
    targetLanguage: d.targetLanguage,
    vibe: d.defaultVibe,
    temperature: input.temperature,
    persona: input.persona,
    instructions: input.instructions,
  })

  const toggleTrait = (t: string) =>
    setD((prev) => {
      const traits = new Set(prev.traits)
      if (traits.has(t)) traits.delete(t)
      else traits.add(t)
      return { ...prev, traits }
    })

  const submit = async () => {
    const parsed = characterFormSchema.safeParse(input)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form')
      return
    }
    setError(null)
    await onSave(input)
  }

  return (
    <>
      <div className="cust-scrim" onClick={onClose}></div>
      <aside
        className="cust"
        role="dialog"
        aria-label={isCreate ? 'New character' : 'Customize character'}
      >
        <div className="cust__head">
          <h3 className="cust__title">
            {isCreate
              ? 'New character'
              : `Customize character · ${character.name}`}
          </h3>
          <button
            type="button"
            className="cust__close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="cust__body">
          <div className="cust__group">
            <div className="cust__group-h">IDENTITY</div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-name">
                Name
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div
                  className="threads__char-avatar"
                  style={{ background: d.color, flexShrink: 0 }}
                >
                  {initialsFor(d.name)}
                </div>
                <input
                  id="cp-name"
                  className="cust__input"
                  value={d.name}
                  autoFocus={isCreate}
                  placeholder="Oba-chan"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
            </div>
            <div className="cust__field">
              <label className="cust__label">Color</label>
              <div className="cust__chip-row">
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={
                      'cust__swatch ' + (d.color === c ? 'is-active' : '')
                    }
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => patch({ color: c })}
                  />
                ))}
              </div>
            </div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-age">
                Age
              </label>
              <input
                id="cp-age"
                className="cust__input"
                value={d.age}
                placeholder="60s"
                onChange={(e) => patch({ age: e.target.value })}
              />
            </div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-region">
                Region
              </label>
              <input
                id="cp-region"
                className="cust__input"
                list="cp-regions"
                value={d.region}
                placeholder="Osaka"
                onChange={(e) => patch({ region: e.target.value })}
              />
              <datalist id="cp-regions">
                {REGION_SUGGESTIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">LANGUAGES</div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-src">
                From
              </label>
              <select
                id="cp-src"
                className="cust__select"
                value={d.sourceLanguage}
                onChange={(e) => patch({ sourceLanguage: e.target.value })}
              >
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            </div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-tgt">
                To
              </label>
              <select
                id="cp-tgt"
                className="cust__select"
                value={d.targetLanguage}
                onChange={(e) => patch({ targetLanguage: e.target.value })}
              >
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            </div>
            <div className="cust__field">
              <label className="cust__label">Default vibe</label>
              <div className="cust__chip-row">
                {vibes.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    className={
                      'cust__chip ' +
                      (d.defaultVibe === v.id ? 'is-active' : '')
                    }
                    style={
                      d.defaultVibe === v.id
                        ? { color: v.color, borderColor: v.color }
                        : undefined
                    }
                    onClick={() => patch({ defaultVibe: v.id as VibeStop })}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">VOICE</div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-tone">
                Tone
              </label>
              <select
                id="cp-tone"
                className="cust__select"
                value={d.tone}
                onChange={(e) => patch({ tone: e.target.value })}
              >
                <option value="">Neutral</option>
                {d.tone && !TONE_OPTIONS.includes(d.tone) && (
                  <option value={d.tone}>{d.tone}</option>
                )}
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="cust__field">
              <label className="cust__label" htmlFor="cp-formality">
                Formality
              </label>
              <input
                id="cp-formality"
                className="cust__input"
                value={d.formality}
                placeholder="warm but blunt"
                onChange={(e) => patch({ formality: e.target.value })}
              />
            </div>
            <div className="cust__field">
              <label className="cust__label">Verbosity</label>
              <Slider
                value={d.verbosity}
                onChange={(v) => patch({ verbosity: v })}
                label="Verbosity"
              />
            </div>
            <div className="cust__field">
              <label className="cust__label">Temperature</label>
              <Slider
                value={d.temperature}
                onChange={(v) => patch({ temperature: v })}
                label="Temperature"
              />
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">TRAITS</div>
            <div className="cust__chip-row">
              {[
                ...TRAIT_OPTIONS,
                ...Array.from(d.traits).filter(
                  (t) => !TRAIT_OPTIONS.includes(t),
                ),
              ].map((t) => (
                <button
                  type="button"
                  key={t}
                  className={
                    'cust__chip ' + (d.traits.has(t) ? 'is-active' : '')
                  }
                  onClick={() => toggleTrait(t)}
                >
                  {d.traits.has(t) && '✓ '}
                  {t}
                </button>
              ))}
            </div>
            <input
              className="cust__input"
              style={{ marginTop: 10 }}
              placeholder="Add a custom trait and press Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const value = (e.target as HTMLInputElement).value.trim()
                  if (value) {
                    toggleTrait(value)
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }
              }}
            />
          </div>

          <div className="cust__group">
            <div className="cust__group-h">INSTRUCTIONS · FREE-FORM</div>
            <textarea
              className="cust__textarea"
              rows={3}
              value={d.instructions}
              placeholder="Kenji is your college roommate from Osaka; keep it Kansai-ben and tease a little."
              onChange={(e) => patch({ instructions: e.target.value })}
            />
          </div>

          <div className="cust__group">
            <div className="cust__group-h">SYSTEM PROMPT · COMPILED</div>
            <pre className="cust__sysprompt">{sysprompt}</pre>
          </div>

          {error && <p className="cust__error">{error}</p>}
        </div>
        {!isCreate && onDelete && confirmingDelete && (
          <div className="cust__confirm">
            <p>
              This deletes <strong>{character.name}</strong> and every thread
              and translation under them. It cannot be undone. Type the name to
              confirm.
            </p>
            <div className="cust__confirm-row">
              <input
                className="cust__input"
                autoFocus
                value={confirmName}
                placeholder={character.name}
                aria-label={`Type ${character.name} to confirm deletion`}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <button
                type="button"
                className="vt-btn vt-btn--ghost"
                onClick={() => {
                  setConfirmingDelete(false)
                  setConfirmName('')
                }}
              >
                Keep
              </button>
              <button
                type="button"
                className="vt-btn vt-btn--ghost cust__danger"
                onClick={onDelete}
                disabled={
                  saving || confirmName.trim() !== character.name.trim()
                }
              >
                <Icon name="trash" /> Delete forever
              </button>
            </div>
          </div>
        )}
        <div className="cust__foot">
          {!isCreate && onDelete && !confirmingDelete && (
            <button
              type="button"
              className="vt-btn vt-btn--ghost cust__danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              <Icon name="trash" /> Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="vt-btn vt-btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="vt-btn vt-btn--primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : isCreate
                ? 'Create character'
                : 'Save character'}
          </button>
        </div>
      </aside>
    </>
  )
}
