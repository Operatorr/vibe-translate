export type UserTier = 'free' | 'pro' | 'team'

export type VibeStop =
  | 'yakuza'
  | 'friend'
  | 'casual'
  | 'keigo'
  | 'keigoplus'
  | 'emperor'

export type Persona = {
  age?: string
  region?: string
  formality?: string
  tone?: string
  verbosity?: number
  traits: string[]
}

export type Character = {
  id: string
  name: string
  initials?: string
  color?: string
  sourceLanguage: string
  targetLanguage: string
  defaultVibe: VibeStop
  temperature: number
  persona: Persona
  instructions?: string
  sortOrder: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CharacterDraft = {
  ok: boolean
  name?: string
  sourceLanguage?: string
  targetLanguage?: string
  defaultVibe?: VibeStop
  temperature?: number
  persona?: Persona
  instructions?: string
}

export type Thread = {
  id: string
  characterId: string
  title: string
  starred: boolean
  segmentCount: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ThreadShare = {
  shared: boolean
  token: string | null
  url: string | null
}

// Public payload behind a share link (GET /api/share/:token). Redacted: no
// user ids, no token usage.
export type SharedThread = {
  thread: { title: string; createdAt: string; updatedAt: string }
  character: {
    name: string
    initials?: string
    color?: string
    sourceLanguage: string
    targetLanguage: string
    defaultVibe: VibeStop
  }
  segments: Array<{
    id: string
    sourceText: string
    targetText: string
    vibe: VibeStop
    tokenAlignment: SegmentToken[]
    createdAt: string
  }>
}

export type SegmentToken = {
  t: string
  src: string
}

export type Segment = {
  id: string
  threadId: string
  sourceText: string
  targetText: string
  vibe: VibeStop | null
  tokenAlignment: SegmentToken[]
  tokenUsage: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ActivityLogItem = {
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreditBalance = {
  balance: number
  refilledAt: string | null
}

export type ByokState = {
  configured: boolean
  last4: string | null
  translateModelId: string | null
  explainModelId: string | null
}

export type TierLimits = {
  characters: number
  threadsPerCharacter: number
  credits: number
  retentionDays: number
  aiDictation: boolean
  explain: boolean
  translationMemory: boolean
  customVibeStops: boolean
  elevenLabsTts: boolean
}

export type Me = {
  id: string
  email: string | null
  displayName: string | null
  tier: UserTier
  limits: TierLimits
  credits: CreditBalance
  byok: ByokState
  onboardingComplete: boolean
}

// Explain body shapes mirror api/_lib/explain.ts. Japanese targets get the
// full breakdown; other languages get the generic scaffold.
export type ExplainGloss = { token: string; gloss: string }
export type ExplainMorpheme = {
  surface: string
  base: string
  reading: string
  role: 'verb' | 'noun' | 'particle' | 'aux' | 'adjective' | 'adverb' | 'punct' | 'other'
  inflection: string
}
export type ExplainKanji = {
  char: string
  on: string[]
  kun: string[]
  radicals: string[]
  strokeCount: number
  jlpt: string
}
export type ExplainGrammar = { pattern: string; note: string; dialectNote?: string }
export type ExplainBody = {
  romaji: string
  literalGloss: ExplainGloss[]
  morphemes?: ExplainMorpheme[]
  kanji?: ExplainKanji[]
  grammarPatterns: ExplainGrammar[]
}

export type ExplainPayload = {
  segmentId: string
  version: number
  body: ExplainBody | null
  cached: boolean
}

export type MemoryHit = {
  segmentId: string
  similarity: number
}
