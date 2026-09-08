// `credits` is the monthly credit grant on the platform key path. BYOK users
// bypass this entirely and pay OpenRouter directly. See docs/adr/0003.
export const tierLimits = {
  free: {
    characters: 5,
    threadsPerCharacter: 20,
    credits: 1000,
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
    credits: 25000,
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
    credits: 250000,
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
