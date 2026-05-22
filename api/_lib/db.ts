import { Client } from 'pg'

import type { Bindings } from './env'

export type { Client }

export function createDbClient(env: Bindings) {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL or HYPERDRIVE binding is required')
  }

  return new Client({ connectionString })
}

// Open a connection, run `fn`, and always close — the per-request pattern for
// every DB-backed route handler (mirrors /api/diagnostics). The Workers runtime
// is request-scoped, so a fresh client per request is intentional.
export async function withDb<T>(env: Bindings, fn: (db: Client) => Promise<T>): Promise<T> {
  const db = createDbClient(env)
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end().catch(() => undefined)
  }
}
