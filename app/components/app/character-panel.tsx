import * as React from 'react'

import { CharacterSettingHelp } from './character-setting-help'

import { Icon } from '@/components/vibe-design/icon'
import {
  LANG_NAME,
  getVibesForLang,
} from '@/components/vibe-design/design-data'
import type { CharacterInput } from '@/hooks/use-app-data'
import {
  type Draft,
  draftFrom,
  switchTargetLanguage,
  toInput,
} from '@/lib/character-draft'
import {
  CHARACTER_LANGUAGES,
  SOURCE_LANGUAGES,
  getRegionsForLanguage,
  getTraitsForLanguage,
} from '@/lib/character-options'
import { initialsFor } from '@/lib/initials'
import { characterEditSchema, characterFormSchema } from '@/lib/schemas'
import { compileSystemPrompt } from '@/lib/system-prompt'
import type { Character, VibeStop } from '@/lib/types'

const LANGUAGE_NAMES = LANG_NAME as Record<string, string>
const LANGUAGE_CODES = CHARACTER_LANGUAGES

const TONE_OPTIONS = ['warm', 'dry', 'playful', 'stern', 'gentle', 'brisk']
const COLORS = [
  'var(--magenta-400)',
  'var(--cyan-400)',
  'var(--orange-400)',
  'var(--turq-400)',
  'var(--blue-400)',
  'var(--amber-400)',
  'var(--red-400)',
]

const Slider = ({
  value,
  onChange,
  label,
  id,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  id: string
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
        id={id}
        aria-describedby={`${id}-help`}
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
  const [d, setD] = React.useState<Draft>(() =>
    draftFrom(character, COLORS[Math.floor(Math.random() * COLORS.length)]),
  )
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Deleting cascades to every Thread and Segment, so it takes typing the
  // Character's name rather than a one-tap browser confirm.
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [confirmName, setConfirmName] = React.useState('')
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))
  const vibes = getVibesForLang(d.targetLanguage)
  const isCreate = character === null
  const regions = getRegionsForLanguage(d.targetLanguage)
  // The former formality field is edit-only: shown for Characters that saved a
  // value, and kept mounted while the draft is cleared so it can be retyped.
  const hasVoiceNotes = !!character?.persona.formality
  const traitOptions = getTraitsForLanguage(d.targetLanguage)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !helpOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, helpOpen])

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
    const schema = character
      ? characterEditSchema(character)
      : characterFormSchema
    const parsed = schema.safeParse(input)
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
                {!SOURCE_LANGUAGES.some(
                  (code) => code === d.sourceLanguage,
                ) && (
                  <option value={d.sourceLanguage} disabled>
                    {LANGUAGE_NAMES[d.sourceLanguage] ?? d.sourceLanguage} ·
                    choose a supported language
                  </option>
                )}
                {SOURCE_LANGUAGES.map((code) => (
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
                onChange={(e) =>
                  setD((prev) => switchTargetLanguage(prev, e.target.value))
                }
              >
                {!LANGUAGE_CODES.some((code) => code === d.targetLanguage) && (
                  <option value={d.targetLanguage} disabled>
                    {LANGUAGE_NAMES[d.targetLanguage] ?? d.targetLanguage} ·
                    choose a supported language
                  </option>
                )}
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            </div>
            <div className="cust__field cust__field--top">
              <label className="cust__label" htmlFor="cp-region">
                Region / dialect
              </label>
              <div className="cust__control">
                <input
                  id="cp-region"
                  className="cust__input"
                  value={d.region}
                  placeholder={
                    d.targetLanguage === 'zh-TW'
                      ? 'e.g. Taichung'
                      : (regions[0] ?? 'City or region')
                  }
                  aria-describedby="cp-region-help"
                  maxLength={120}
                  onChange={(e) => patch({ region: e.target.value })}
                />
                <p id="cp-region-help" className="cust__helper">
                  Choose a suggestion or type any city or region, such as
                  Taichung. Suggestions follow the “To” language.
                </p>
                <div
                  className="cust__chip-row cust__region-suggestions"
                  role="group"
                  aria-label="Region suggestions"
                >
                  {regions.map((region) => (
                    <button
                      type="button"
                      key={region}
                      className={
                        'cust__chip ' + (d.region === region ? 'is-active' : '')
                      }
                      aria-pressed={d.region === region}
                      onClick={() => patch({ region })}
                    >
                      {region}
                    </button>
                  ))}
                </div>
                {d.targetLanguage === 'zh-TW' && (
                  <p className="cust__helper">
                    Taiwan uses Taiwanese Mandarin. The Hong Kong and Guangzhou
                    suggestions use Cantonese wording, written in traditional
                    characters.
                  </p>
                )}
              </div>
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
                    aria-pressed={d.defaultVibe === v.id}
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
                Personality tone
              </label>
              <select
                id="cp-tone"
                className="cust__select"
                value={d.tone}
                aria-describedby="cp-tone-help"
                onChange={(e) => patch({ tone: e.target.value })}
              >
                <option value="">Neutral</option>
                {d.tone && !TONE_OPTIONS.includes(d.tone) && (
                  <option value={d.tone}>{d.tone} (existing)</option>
                )}
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <p id="cp-tone-help" className="cust__helper">
              Tone adds warmth or attitude within the selected vibe. Vibe
              controls politeness and formality, so a warm Keigo translation
              stays polite.
            </p>
            {hasVoiceNotes && (
              <div className="cust__field cust__field--top">
                <label className="cust__label" htmlFor="cp-formality">
                  Existing voice notes
                </label>
                <div className="cust__control">
                  <input
                    id="cp-formality"
                    className="cust__input"
                    value={d.formality}
                    onChange={(e) => patch({ formality: e.target.value })}
                  />
                  <p className="cust__helper">
                    Saved from the former formality field. The selected vibe
                    takes priority. Clear this to remove it.
                  </p>
                </div>
              </div>
            )}
            <div className="cust__field cust__field--top">
              <div className="cust__label-row">
                <label className="cust__label" htmlFor="cp-verbosity">
                  Verbosity
                </label>
                <CharacterSettingHelp
                  setting="verbosity"
                  onOpenChange={setHelpOpen}
                />
              </div>
              <div className="cust__control">
                <Slider
                  value={d.verbosity}
                  onChange={(v) => patch({ verbosity: v })}
                  label="Verbosity"
                  id="cp-verbosity"
                />
                <p id="cp-verbosity-help" className="cust__helper">
                  Brief or fuller phrasing, with the same meaning. Default:
                  natural length.
                </p>
              </div>
            </div>
            <div className="cust__field cust__field--top">
              <div className="cust__label-row">
                <label className="cust__label" htmlFor="cp-temperature">
                  Temperature
                </label>
                <CharacterSettingHelp
                  setting="temperature"
                  onOpenChange={setHelpOpen}
                />
              </div>
              <div className="cust__control">
                <Slider
                  value={d.temperature}
                  onChange={(v) => patch({ temperature: v })}
                  label="Temperature"
                  id="cp-temperature"
                />
                <p id="cp-temperature-help" className="cust__helper">
                  Lower: predictable wording. Higher: more variation. Vibe still
                  sets politeness.
                </p>
              </div>
            </div>
          </div>

          <div className="cust__group">
            <div className="cust__group-h">TRAITS</div>
            <div className="cust__chip-row">
              {[
                ...traitOptions,
                ...Array.from(d.traits).filter(
                  (t) => !traitOptions.includes(t),
                ),
              ].map((t) => (
                <button
                  type="button"
                  key={t}
                  className={
                    'cust__chip ' + (d.traits.has(t) ? 'is-active' : '')
                  }
                  aria-pressed={d.traits.has(t)}
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
