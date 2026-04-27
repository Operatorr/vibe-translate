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
}

export type Variables = {
  userId: string
  email: string | null
  databaseUrl: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
