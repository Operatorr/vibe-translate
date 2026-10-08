import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { Client, type ClientConfig } from 'pg'
import { loadMigrations, migrate, withCleanup } from './db-migration-runner.ts'

type Env = Record<string, string | undefined>
type DatabaseTarget = { productionHost: string; productionDatabase: string }

const root = new URL('../', import.meta.url)
const envFile = (name: string) => {
  const path = new URL(name, root)
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}

// pg copies every query parameter into its client config, so host, port, user,
// dbname, options (Neon endpoint routing), ssl files and the like could
// re-route or weaken a URL that passed the endpoint checks below. Accept only
// parameters that cannot change the target.
const QUERY_PARAMETERS = new Set([
  'sslmode',
  'channel_binding',
  'application_name',
])
// DNS names are case-insensitive and may end in a root dot; compare one spelling.
const canonicalHost = (host: string) => host.toLowerCase().replace(/\.$/, '')
// Neon routes on the endpoint ID in the first label, whatever the domain alias.
const neonEndpoint = (host: string) =>
  host.endsWith('.neon.tech')
    ? host.split('.')[0].replace(/-pooler$/, '')
    : undefined

export function migrationConnection(
  production: boolean,
  env: Env,
  local: Env,
  productionEnv: Env,
  target: DatabaseTarget,
) {
  if (!target.productionHost || !target.productionDatabase)
    throw new Error('Invalid database target configuration.')
  const productionHost = canonicalHost(target.productionHost)
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
  let url: URL
  try {
    url = new URL(value)
  } catch {
    // URL errors carry the input, password included.
    throw new Error('The database URL is not a valid URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('A PostgreSQL connection string is required.')
  for (const key of url.searchParams.keys())
    if (!QUERY_PARAMETERS.has(key))
      throw new Error(
        `Remove "${key}" from the database URL; only ${[...QUERY_PARAMETERS].join(', ')} are accepted.`,
      )
  // An empty or percent-encoded host would make pg use PGHOST or a socket path.
  const host = canonicalHost(url.hostname)
  if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(host))
    throw new Error('The database URL needs a DNS host name.')
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!database) throw new Error('The database URL must name a database.')
  // Neon poolers do not support session advisory locks. Keep the same endpoint,
  // database and credentials, but use its direct host for migration sessions.
  if (host.endsWith('.neon.tech'))
    url.hostname = host.replace(/^([^.]+)-pooler\./, '$1.')
  else if (host.includes('-pooler.'))
    throw new Error('Use a direct database connection for migrations.')
  else url.hostname = host
  // pg would otherwise take a missing port from PGPORT.
  url.port ||= '5432'
  if (
    production &&
    (url.hostname !== productionHost || database !== target.productionDatabase)
  )
    throw new Error(
      'Production URL does not match the configured production host and database.',
    )
  const endpoint = neonEndpoint(url.hostname)
  if (
    !production &&
    (url.hostname === productionHost ||
      (endpoint && endpoint === neonEndpoint(productionHost)))
  )
    throw new Error('Production database requires --production.')
  if (url.hostname.endsWith('.neon.tech'))
    url.searchParams.set('sslmode', 'verify-full')
  return url
}

// pg parses the URL again and fills gaps from PG* variables, so confirm the
// client it built targets the validated host, port and database.
export function migrationClient(
  url: URL,
  // pg supports SCRAM channel binding; @types/pg does not declare it yet.
  config: Omit<ClientConfig, 'connectionString'> & {
    enableChannelBinding?: boolean
  } = {},
) {
  const client = new Client({ ...config, connectionString: url.toString() })
  if (
    client.host !== url.hostname ||
    client.port !== Number(url.port) ||
    client.database !== decodeURIComponent(url.pathname.slice(1))
  )
    throw new Error(
      'The effective connection target differs from the validated database URL.',
    )
  return client
}

const readTargets = () =>
  JSON.parse(
    readFileSync(new URL('../db/targets.json', import.meta.url), 'utf8'),
  ) as DatabaseTarget
const localEnvFiles = () => ({
  ...envFile('.dev.vars'),
  ...envFile('.env'),
  ...envFile('.env.local'),
})

// The Local target exactly as `pnpm db:migrate` resolves it. Opt-in fixture
// tests use this too, so they share the CLI's endpoint guard and never fall
// back to an ambient DATABASE_URL.
export function localDatabaseUrl(
  env: Env = process.env,
  files: Env = localEnvFiles(),
) {
  if (env.APP_ENV === 'production')
    throw new Error('Refusing Local database work with APP_ENV=production.')
  return migrationConnection(false, env, files, {}, readTargets())
}

// PostgreSQL errors may carry SQL/data in detail; report only messages. Cleanup
// failures arrive as AggregateError entries beside the error that caused them.
export function errorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) return []
  return [
    ...(error.message ? [error.message] : []),
    ...(error instanceof AggregateError
      ? error.errors.flatMap(errorMessages)
      : []),
    ...errorMessages(error.cause),
  ]
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
  const url = production
    ? migrationConnection(
        true,
        process.env,
        {},
        envFile('.env.production.local'),
        readTargets(),
      )
    : localDatabaseUrl()
  const migrations = await loadMigrations(
    fileURLToPath(new URL('db/migrations', root)),
    fileURLToPath(new URL('db/migrations.json', root)),
  )
  console.log(
    `Database target: ${production ? 'Production' : 'Local'} (${url.hostname}/${url.pathname.slice(1)})`,
  )
  const db = migrationClient(url, {
    connectionTimeoutMillis: 15_000,
    enableChannelBinding: true,
  })
  await withCleanup(
    'Disconnect',
    async () => {
      await db.connect()
      await migrate(db, migrations, { baseline, status, log: console.log })
    },
    () => db.end(),
  )
}

// Importing the connection resolver in tests must not run the CLI.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    for (const message of errorMessages(error)) console.error(message)
    process.exitCode = 1
  })
}
