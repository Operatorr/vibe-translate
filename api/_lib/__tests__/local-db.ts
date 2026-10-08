import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'

import { localDatabaseUrl, migrationClient } from '../../../scripts/db-migrate'

// Helpers for opt-in fixture tests (RUN_LOCAL_DB_PERF=1). Local resolves
// exactly as `pnpm db:migrate` does: never an ambient DATABASE_URL, never
// APP_ENV=production or the production host. Call only inside an opted-in
// test so a default run never reads local env files.
export function localClients(count: number): Client[] {
  const url = localDatabaseUrl()
  return Array.from({ length: count }, () =>
    migrationClient(url, { connectionTimeoutMillis: 15_000 }),
  )
}

// Unique per run so concurrent or aborted runs never collide on fixture rows.
export const fixtureId = (label: string) =>
  `vt-fixture-${label}-${randomUUID()}`

// Runs `body`, then always attempts `cleanup` and closes every client. The
// body's failure is rethrown unchanged with cleanup errors logged beside it;
// when the body passed, cleanup errors fail the test so leaks are never silent.
export async function withLocalFixtures(
  clients: Client[],
  body: () => Promise<void>,
  cleanup: () => Promise<unknown>,
) {
  let failure: { error: unknown } | null = null
  try {
    await body()
  } catch (error) {
    failure = { error }
  }
  const cleanupErrors: unknown[] = []
  await cleanup().catch((error: unknown) => cleanupErrors.push(error))
  const closed = await Promise.allSettled(clients.map((client) => client.end()))
  for (const result of closed)
    if (result.status === 'rejected') cleanupErrors.push(result.reason)
  if (failure) {
    if (cleanupErrors.length > 0)
      console.error('Local fixture cleanup failed', cleanupErrors)
    throw failure.error
  }
  if (cleanupErrors.length > 0)
    throw new AggregateError(cleanupErrors, 'Local fixture cleanup failed')
}
