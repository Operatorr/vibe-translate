import {
  getRegionsForLanguage,
  getTraitsForLanguage,
} from './character-options'
import { initialsFor } from './initials'
import type { Character, VibeStop } from './types'

import type { CharacterInput } from '@/hooks/use-app-data'

// Editable state behind the Character panel, plus the pure transitions on it.
// Kept out of the component so the language-switch and save rules are testable.

// Slider position that means "no verbosity guidance" (omitted from the persona).
export const DEFAULT_VERBOSITY = 0.4

export type Draft = {
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

export function draftFrom(
  char: Character | null,
  fallbackColor: string,
): Draft {
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
    color: char?.color ?? fallbackColor,
    instructions: char?.instructions ?? '',
  }
}

export function toInput(d: Draft): CharacterInput {
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

// Changing the "To" language drops only the old language's suggestions: a
// suggested region and traits unique to the old language. Custom regions,
// custom traits and traits the new language also offers are preserved.
export function switchTargetLanguage(d: Draft, targetLanguage: string): Draft {
  const oldRegions = getRegionsForLanguage(d.targetLanguage)
  const oldTraits = getTraitsForLanguage(d.targetLanguage)
  const nextTraits = getTraitsForLanguage(targetLanguage)
  return {
    ...d,
    targetLanguage,
    region: oldRegions.includes(d.region) ? '' : d.region,
    traits: new Set(
      [...d.traits].filter(
        (trait) => !oldTraits.includes(trait) || nextTraits.includes(trait),
      ),
    ),
  }
}

// PATCH body for an edit. Unchanged languages are omitted so a Character saved
// with a now-unsupported (legacy) language can still save unrelated edits —
// the worker validates any language it receives against the supported list.
export function toCharacterPatch(
  input: CharacterInput,
  original: Pick<Character, 'sourceLanguage' | 'targetLanguage'>,
): Partial<CharacterInput> {
  const { sourceLanguage, targetLanguage, ...rest } = input
  return {
    ...rest,
    ...(sourceLanguage !== original.sourceLanguage && { sourceLanguage }),
    ...(targetLanguage !== original.targetLanguage && { targetLanguage }),
  }
}
