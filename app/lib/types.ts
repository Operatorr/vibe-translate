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
  archivedAt: string | null
  createdAt: string
  updatedAt: string
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

export type ExplainPayload = {
  segmentId: string
  version: number
  body: Record<string, unknown> | null
  cached: boolean
}

export type MemoryHit = {
  segmentId: string
  similarity: number
}
