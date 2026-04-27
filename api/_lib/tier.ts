export const tierLimits = {
  free: {
    chats: 5,
    translationsPerMonth: 100,
    retentionDays: 30,
    aiDictation: false,
  },
  pro: {
    chats: 100,
    translationsPerMonth: 5000,
    retentionDays: 365,
    aiDictation: true,
  },
  team: {
    chats: 1000,
    translationsPerMonth: 50000,
    retentionDays: 1095,
    aiDictation: true,
  },
} as const

export type Tier = keyof typeof tierLimits
