export type UserTier = 'free' | 'pro' | 'team'

export type Chat = {
  id: string
  title: string
  sourceLanguage: string
  targetLanguage: string
  createdAt: string
  updatedAt: string
}

export type Translation = {
  id: string
  chatId: string
  sourceText: string
  translatedText: string
  createdAt: string
  updatedAt: string
}

export type ActivityLogItem = {
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: string
}
