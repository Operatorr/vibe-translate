import { Client } from 'pg'

import type { Bindings } from './env'

export function createDbClient(env: Bindings) {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL or HYPERDRIVE binding is required')
  }

  return new Client({ connectionString })
}
