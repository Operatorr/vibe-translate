// The four languages offered for new Characters. Legacy language names remain
// in design-data so existing Characters and shared threads still display well.
export const CHARACTER_LANGUAGES = ['zh-CN', 'zh-TW', 'th-TH', 'ja-JP'] as const
export const SOURCE_LANGUAGES = ['en-US', ...CHARACTER_LANGUAGES] as const

export const REGION_SUGGESTIONS: Record<string, string[]> = {
  'zh-CN': ['Beijing', 'Singapore', 'Malaysia'],
  'zh-TW': ['Taiwan', 'Hong Kong (Cantonese)', 'Guangzhou (Cantonese)'],
  'th-TH': [
    'Bangkok',
    'Chiang Mai (North)',
    'Isan / Esarn (Northeast)',
    'South',
  ],
  'ja-JP': [
    'Tokyo',
    'Osaka (Kansai)',
    'Kyoto (Kansai)',
    'Tohoku',
    'Hokkaido',
    'Okinawa',
  ],
}

const COMMON_TRAITS = [
  'direct',
  'playful',
  'blunt',
  'poetic',
  'technical',
  'gen-z',
  'no slang',
  'occasional code-switch',
]
const LANGUAGE_TRAITS: Record<string, string[]> = {
  'zh-CN': [
    'Mandarin idioms',
    'internet slang',
    'English code-switching',
    'Singaporean Mandarin expressions',
    'Malaysian Mandarin expressions',
  ],
  'zh-TW': [
    'Taiwanese Mandarin expressions',
    'Mandarin idioms',
    'Cantonese expressions',
    'Cantonese sentence particles',
    'English code-switching',
  ],
  'th-TH': [
    'Thai idioms',
    'expressive sentence particles',
    'Northern Thai expressions',
    'Isan expressions',
    'Southern Thai expressions',
    'English code-switching',
  ],
  'ja-JP': [
    'dialect: kansai-ben',
    'dialect: tohoku',
    'expressive sentence particles',
    'Japanese idioms',
    'casual contractions',
  ],
}

export function getTraitsForLanguage(language: string): string[] {
  return [...COMMON_TRAITS, ...(LANGUAGE_TRAITS[language] ?? [])]
}
