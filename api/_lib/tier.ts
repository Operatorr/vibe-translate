import { UNITS_PER_DOLLAR } from './credit-units'

// `credits` is in integer accounting units; Free is a one-time welcome grant,
// paid allowances are monthly (annual billing grants twelve months at once).
// BYOK users bypass credits
// and pay OpenRouter directly. See docs/adr/0003.
export const tierLimits = {
  free: {
    characters: 3,
    threadsPerCharacter: 20,
    credits: 0.1 * UNITS_PER_DOLLAR,
    retentionDays: 30,
    aiDictation: false,
    explain: false,
    translationMemory: false,
    customVibeStops: false,
    // Per-vibe ElevenLabs voices. Free tier reads back with the browser's
    // built-in speech synthesis instead (client-side, no API call).
    elevenLabsTts: false,
  },
  pro: {
    characters: 100,
    threadsPerCharacter: 200,
    credits: 5 * UNITS_PER_DOLLAR,
    retentionDays: 365,
    aiDictation: true,
    explain: true,
    translationMemory: true,
    customVibeStops: false,
    elevenLabsTts: true,
  },
  team: {
    characters: 1000,
    threadsPerCharacter: 2000,
    credits: 20 * UNITS_PER_DOLLAR,
    retentionDays: 1095,
    aiDictation: true,
    explain: true,
    translationMemory: true,
    customVibeStops: true,
    elevenLabsTts: true,
  },
} as const

export type Tier = keyof typeof tierLimits
export type TierLimits = (typeof tierLimits)[Tier]
