export type Bindings = {
  APP_ENV?: 'development' | 'preview' | 'production'
  APP_URL?: string
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY?: string
  DATABASE_URL?: string
  HYPERDRIVE?: Hyperdrive
  RESEND_API_KEY?: string
  DODO_API_KEY?: string
  DODO_WEBHOOK_SECRET?: string
  OPENROUTER_API_KEY?: string
  OPENAI_API_KEY?: string
  // 32-byte secret (base64) for AES-GCM encryption of BYOK OpenRouter keys.
  // Rotate by re-encrypting all stored ciphers; see SECURITY.md.
  CREDENTIALS_ENCRYPTION_KEY?: string
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_MODEL_ID?: string
  ELEVENLABS_VOICE_YAKUZA?: string
  ELEVENLABS_VOICE_FRIEND?: string
  ELEVENLABS_VOICE_CASUAL?: string
  ELEVENLABS_VOICE_KEIGO?: string
  ELEVENLABS_VOICE_KEIGOPLUS?: string
  ELEVENLABS_VOICE_EMPEROR?: string
}

export type Variables = {
  userId: string
  email: string | null
  databaseUrl?: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
