export type Bindings = {
  APP_ENV?: 'development' | 'preview' | 'production'
  APP_URL?: string
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY?: string
  DATABASE_URL?: string
  HYPERDRIVE?: Hyperdrive
  RESEND_API_KEY?: string
  // Optional From address for transactional email; defaults applied in email.ts.
  RESEND_FROM?: string
  DODO_API_KEY?: string
  DODO_WEBHOOK_SECRET?: string
  // Dodo product ids per plan/billing period. Used to build checkout sessions
  // and as the fallback when resolving a webhook's plan if metadata is absent.
  DODO_PRODUCT_PRO?: string
  DODO_PRODUCT_PRO_ANNUAL?: string
  DODO_PRODUCT_TEAM?: string
  DODO_PRODUCT_TEAM_ANNUAL?: string
  OPENROUTER_API_KEY?: string
  // Optional per-task model + reasoning overrides (see adr/0003). `*_MODEL`
  // pins an OpenRouter slug; `*_REASONING` sets reasoning effort
  // (low|medium|high). When unset, the `models` registry default applies. These
  // override the platform default; a user's BYOK per-task model still wins.
  TRANSLATE_MODEL?: string
  TRANSLATE_REASONING?: string
  EXPLAIN_MODEL?: string
  EXPLAIN_REASONING?: string
  DICTATION_MODEL?: string
  DICTATION_REASONING?: string
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
