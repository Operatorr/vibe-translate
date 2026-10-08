import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { Client } from 'pg'
import { loadMigrations, migrate } from './db-migration-runner.ts'

const root = new URL('../', import.meta.url)
const envFile = (name: string) => {
  const path = new URL(name, root)
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}

export function migrationConnection(
  production: boolean,
  env: Record<string, string | undefined>,
  local: Record<string, string | undefined>,
  productionEnv: Record<string, string | undefined>,
  target: { productionHost: string; productionDatabase: string },
) {
  if (!target.productionHost || !target.productionDatabase)
    throw new Error('Invalid database target configuration.')
  const value = production
    ? (env.PRODUCTION_DATABASE_URL ?? productionEnv.PRODUCTION_DATABASE_URL)
    : (env.MIGRATION_DATABASE_URL ??
      local.MIGRATION_DATABASE_URL ??
      local.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
      local.DATABASE_URL)
  if (!value)
    throw new Error(
      production
        ? 'Set PRODUCTION_DATABASE_URL in .env.production.local or the environment. Production never falls back to local credentials.'
        : 'Set local DATABASE_URL in .dev.vars, or MIGRATION_DATABASE_URL in the environment.',
    )
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('A PostgreSQL connection string is required.')
  // Neon poolers do not support session advisory locks. Keep the same endpoint,
  // database and credentials, but use its direct host for migration sessions.
  if (url.hostname.endsWith('.neon.tech'))
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, '')
  else if (url.hostname.includes('-pooler.'))
    throw new Error('Use a direct database connection for migrations.')
  if (
    production &&
    (url.hostname !== target.productionHost ||
      decodeURIComponent(url.pathname.slice(1)) !== target.productionDatabase)
  )
    throw new Error(
      'Production URL does not match the configured production host and database.',
    )
  if (!production && url.hostname === target.productionHost)
    throw new Error('Production database requires --production.')
  if (url.hostname.endsWith('.neon.tech'))
    url.searchParams.set('sslmode', 'verify-full')
  return url
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'pnpm db:migrate [--production] [--status] [--baseline 000N]\nDefault: Local. Baseline is a one-time assertion of manually applied history; pending files then run normally.',
    )
    return
  }
  const production = args.includes('--production')
  const status = args.includes('--status')
  const baselineIndex = args.indexOf('--baseline')
  const baseline = baselineIndex < 0 ? undefined : args[baselineIndex + 1]
  const allowed = new Set(['--production', '--status', '--baseline', baseline])
  if (
    args.some((arg) => !allowed.has(arg)) ||
    (baselineIndex >= 0 && !baseline) ||
    (status && baseline)
  )
    throw new Error(
      'Use --production, --status, or --baseline 000N. See --help.',
    )
  // Mirror the production origin without storing its password. This file is
  // updated only when the production Hyperdrive origin is intentionally moved.
  const targets = JSON.parse(
    readFileSync(new URL('../db/targets.json', import.meta.url), 'utf8'),
  ) as { productionHost: string; productionDatabase: string }
  const url = migrationConnection(
    production,
    process.env,
    { ...envFile('.dev.vars'), ...envFile('.env'), ...envFile('.env.local') },
    envFile('.env.production.local'),
    targets,
  )
  const migrations = await loadMigrations(
    fileURLToPath(new URL('db/migrations', root)),
    fileURLToPath(new URL('db/migrations.json', root)),
  )
  console.log(
    `Database target: ${production ? 'Production' : 'Local'} (${url.hostname}/${url.pathname.slice(1)})`,
  )
  const connection = {
    connectionString: url.toString(),
    connectionTimeoutMillis: 15_000,
    enableChannelBinding: true,
  }
  const db = new Client(connection)
  try {
    await db.connect()
    await migrate(db, migrations, { baseline, status, log: console.log })
  } finally {
    await db.end()
  }
}

// Importing the connection resolver in tests must not run the CLI.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    // PostgreSQL errors may carry SQL/data in detail; log only the message chain.
    let current = error
    while (current instanceof Error) {
      console.error(current.message)
      current = current.cause
    }
    process.exitCode = 1
  })
}
