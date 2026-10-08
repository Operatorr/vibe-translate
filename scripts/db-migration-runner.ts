import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

type Database = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>
}
type MigrationOptions = { transaction?: boolean; verifySql?: string }
export type Migration = {
  name: string
  sql: string
  checksum: string
  transaction: boolean
  verifySql?: string
}
const TABLE = 'public.schema_migrations'
// Session advisory lock key in PostgreSQL's two-int4 form, a keyspace separate
// from single-bigint locks. The namespace is this app's arbitrary tag among
// other lock users of the same database; the id names the migration runner.
// Runners only exclude each other while they agree on the key, so never change it.
export const MIGRATION_LOCK = { namespace: 21474001, id: 1 } as const
const LOCK = `${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.id}`

// PostgreSQL treats every non-ASCII character as an identifier letter.
const IDENTIFIER_START = /[A-Za-z_\u0080-\uffff]/
const IDENTIFIER_PART = /[\w$\u0080-\uffff]/
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/y
const TRANSACTION_CONTROL =
  /^(?:begin|commit|rollback|end|abort|savepoint|release|start\s+transaction|prepare\s+transaction)\b/i
const CONCURRENT_DDL =
  /\b(?:create\s+(?:unique\s+)?index|drop\s+index|reindex\s+(?:\([^)]*\)\s*)?(?:index|table|schema|database|system)|detach\s+partition\s+\S+)\s+concurrently\b/i

const unterminated = () => new Error('Unterminated SQL quote or comment')

// Index after a quoted literal or identifier. Doubled quotes escape in every
// form; E'' strings also take backslash escapes.
function skipQuoted(sql: string, open: number, backslash: boolean) {
  const quote = sql[open]
  for (let i = open + 1; i < sql.length; i++) {
    if (backslash && sql[i] === '\\') i++
    else if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i + 1
      i++
    }
  }
  throw unterminated()
}

// Splits SQL where psql would: semicolons inside strings, quoted identifiers,
// dollar bodies, comments, parentheses and BEGIN ATOMIC routine bodies do not
// end a statement. `code` keeps only executable tokens (comments become spaces,
// quoted text an empty placeholder) so keyword checks ignore prose and data.
function scan(sql: string) {
  const statements: { text: string; code: string }[] = []
  let start = 0
  let code = ''
  let words: string[] = []
  let parens = 0
  let atomic = 0
  const end = (index: number) => {
    if (code.trim())
      statements.push({
        text: sql.slice(start, index).trim(),
        code: code.trim(),
      })
    start = index
    code = ''
    words = []
    parens = 0
    atomic = 0
  }
  let i = 0
  while (i < sql.length) {
    const char = sql[i]
    const next = sql[i + 1]
    DOLLAR_TAG.lastIndex = i
    const tag = char === '$' ? DOLLAR_TAG.exec(sql)?.[0] : undefined
    if (char === '-' && next === '-') {
      // PostgreSQL ends a line comment at either CR or LF.
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++
      code += ' '
    } else if (char === '/' && next === '*') {
      // Block comments nest.
      let depth = 0
      do {
        if (i >= sql.length) throw unterminated()
        const pair = sql.slice(i, i + 2)
        depth += pair === '/*' ? 1 : pair === '*/' ? -1 : 0
        i += pair === '/*' || pair === '*/' ? 2 : 1
      } while (depth)
      code += ' '
    } else if (char === "'" || char === '"') {
      i = skipQuoted(sql, i, false)
      code += char + char
    } else if (tag) {
      const close = sql.indexOf(tag, i + tag.length)
      if (close < 0) throw unterminated()
      i = close + tag.length
      code += '$$'
    } else if (IDENTIFIER_START.test(char)) {
      // Consuming whole identifiers (which may contain $) means a $ right after
      // one is never mistaken for a dollar-quote tag.
      let stop = i + 1
      while (stop < sql.length && IDENTIFIER_PART.test(sql[stop])) stop++
      const word = sql.slice(i, stop).toLowerCase()
      if (word === 'e' && sql[stop] === "'") {
        i = skipQuoted(sql, stop, true)
        code += "''"
        continue
      }
      // psql's heuristic: in CREATE [OR REPLACE] FUNCTION|PROCEDURE, a top-level
      // BEGIN opens a SQL-standard body; CASE nests inside it, and END closes.
      if (words.length < 4) words.push(word)
      if (
        !parens &&
        /^create (?:or replace )?(?:function|procedure)\b/.test(words.join(' '))
      ) {
        if (word === 'begin' || (word === 'case' && atomic)) atomic++
        else if (word === 'end' && atomic) atomic--
      }
      code += sql.slice(i, stop)
      i = stop
    } else {
      if (char === '(') parens++
      else if (char === ')' && parens) parens--
      else if (char === ';' && !parens && !atomic) {
        end(i + 1)
        i++
        continue
      }
      code += char
      i++
    }
  }
  end(sql.length)
  return statements
}

// Nontransactional files run one top-level statement at a time.
export function splitStatements(sql: string): string[] {
  return scan(sql).map((statement) => statement.text)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function loadMigrations(
  directory: string,
  metadataPath: string,
): Promise<Migration[]> {
  const metadata: unknown = JSON.parse(await readFile(metadataPath, 'utf8'))
  if (!isRecord(metadata))
    throw new Error('Migration metadata must be a JSON object.')
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const numbers = new Set<string>()
  for (const name of names) {
    const number = name.match(/^(\d{4})_[a-z0-9_]+\.sql$/)?.[1]
    if (!number || numbers.has(number))
      throw new Error(`Invalid or duplicate migration number: ${name}`)
    numbers.add(number)
  }
  for (const [name, options] of Object.entries(metadata)) {
    if (!names.includes(name))
      throw new Error(`Metadata references missing migration: ${name}`)
    // A misspelt key would silently drop its option, e.g. skip verification.
    if (
      !isRecord(options) ||
      Object.keys(options).some(
        (key) => key !== 'transaction' && key !== 'verifySql',
      )
    )
      throw new Error(`Invalid migration options: ${name}`)
  }
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8')
      const statements = scan(sql)
      if (statements.some(({ code }) => TRANSACTION_CONTROL.test(code)))
        throw new Error(
          `The runner owns transaction control; remove it from ${name}`,
        )
      const options = (metadata[name] ?? {}) as MigrationOptions
      if (
        options.transaction !== undefined &&
        typeof options.transaction !== 'boolean'
      )
        throw new Error(`Invalid transaction setting: ${name}`)
      if (
        options.verifySql !== undefined &&
        (typeof options.verifySql !== 'string' || !options.verifySql.trim())
      )
        throw new Error(`Invalid verification SQL: ${name}`)
      const transaction = options.transaction !== false
      if (
        transaction &&
        statements.some(({ code }) => CONCURRENT_DDL.test(code))
      )
        throw new Error(
          `Declare transaction: false in db/migrations.json for ${name}`,
        )
      return {
        name,
        sql,
        transaction,
        verifySql: options.verifySql,
        checksum: createHash('sha256')
          .update(
            JSON.stringify({
              sql,
              transaction,
              verifySql: options.verifySql ?? null,
            }),
          )
          .digest('hex'),
      }
    }),
  )
}

async function history(db: Database) {
  const exists = await db.query(`select to_regclass('${TABLE}') as table_name`)
  return exists.rows[0]?.table_name
    ? (
        await db.query(
          `select name, checksum, baseline, applied_at from ${TABLE} order by name`,
        )
      ).rows
    : []
}

function checkHistory(
  migrations: Migration[],
  applied: Record<string, unknown>[],
) {
  const files = new Map(
    migrations.map((migration) => [migration.name, migration]),
  )
  for (const row of applied) {
    const file = files.get(String(row.name))
    if (!file) throw new Error(`Applied migration file is missing: ${row.name}`)
    if (file.checksum !== row.checksum)
      throw new Error(
        `Applied migration changed: ${row.name}. Restore it and add a forward migration.`,
      )
  }
  const done = new Set(applied.map((row) => String(row.name)))
  let pending = false
  for (const file of migrations) {
    if (!done.has(file.name)) pending = true
    else if (pending)
      throw new Error(`Migration history has a gap before ${file.name}`)
  }
  return done
}

// Rollback, unlock and disconnect also run after failures. A cleanup failure
// is reported alongside the error that triggered cleanup, never instead of it.
async function throwAfter(
  failure: unknown,
  label: string,
  cleanup: () => Promise<unknown>,
): Promise<never> {
  try {
    await cleanup()
  } catch (error) {
    throw new AggregateError(
      [failure, new Error(`${label} failed.`, { cause: error })],
      `${failure instanceof Error ? failure.message : String(failure)} ${label} also failed.`,
    )
  }
  throw failure
}

// Runs cleanup after work either way. Only a cleanup failure with no work
// failure to explain is thrown on its own.
export async function withCleanup<T>(
  label: string,
  work: () => Promise<T>,
  cleanup: () => Promise<unknown>,
): Promise<T> {
  let result: T
  try {
    result = await work()
  } catch (error) {
    return throwAfter(error, label, cleanup)
  }
  try {
    await cleanup()
  } catch (error) {
    throw new Error(`${label} failed.`, { cause: error })
  }
  return result
}

export async function migrate(
  db: Database,
  migrations: Migration[],
  options: {
    baseline?: string
    status?: boolean
    log?: (message: string) => void
  } = {},
) {
  const log = options.log ?? (() => undefined)
  if (options.status) {
    const applied = await history(db)
    const done = checkHistory(migrations, applied)
    for (const migration of migrations)
      log(
        `${done.has(migration.name) ? 'applied' : 'pending'} ${migration.name}`,
      )
    return
  }
  const lock = await db.query(`select pg_try_advisory_lock(${LOCK}) as locked`)
  if (!lock.rows[0]?.locked)
    throw new Error(
      'Another migration runner is active; retry after it finishes.',
    )
  const rollback = () => db.query('ROLLBACK')
  await withCleanup(
    'Advisory unlock',
    async () => {
      await db.query("set lock_timeout = '5s'")
      await db.query("set statement_timeout = '30min'")
      let applied = await history(db)
      checkHistory(migrations, applied)
      const existing = await db.query(
        "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations') as populated",
      )
      if (
        !applied.length &&
        existing.rows[0]?.populated &&
        options.baseline === undefined
      )
        throw new Error(
          'Existing database has no tracked history. Audit its schema, then run --baseline 000N once; historical SQL will not be replayed.',
        )
      let baseline: Migration[] = []
      if (options.baseline !== undefined) {
        if (applied.length)
          throw new Error(
            'Baseline is only allowed before any migration is tracked.',
          )
        if (!existing.rows[0]?.populated)
          throw new Error(
            'Cannot baseline an empty database; run migrations normally.',
          )
        const index = options.baseline
          ? migrations.findIndex(
              (file) =>
                file.name === options.baseline ||
                file.name.slice(0, 4) === options.baseline,
            )
          : -1
        if (index < 0)
          throw new Error(`Unknown baseline: "${options.baseline}"`)
        baseline = migrations.slice(0, index + 1)
      }
      await db.query(`create table if not exists ${TABLE} (
        name text primary key, checksum text not null,
        applied_at timestamptz not null default now(),
        execution_ms integer not null, baseline boolean not null default false
      )`)
      if (baseline.length) {
        await db.query('BEGIN')
        try {
          for (const file of baseline)
            await db.query(
              `insert into ${TABLE} (name, checksum, execution_ms, baseline) values ($1, $2, 0, true)`,
              [file.name, file.checksum],
            )
          await db.query('COMMIT')
        } catch (error) {
          await throwAfter(error, 'ROLLBACK', rollback)
        }
        log(
          `Recorded baseline through ${baseline.at(-1)!.name}; no historical SQL executed.`,
        )
        applied = await history(db)
      }
      const done = checkHistory(migrations, applied)
      for (const file of migrations) {
        if (done.has(file.name)) continue
        const start = Date.now()
        log(
          `Applying ${file.name}${file.transaction ? '' : ' (outside transaction)'}`,
        )
        if (file.transaction) await db.query('BEGIN')
        try {
          if (file.transaction) await db.query(file.sql)
          else
            for (const statement of splitStatements(file.sql))
              await db.query(statement)
          // Only a boolean true passes; 'false', NULL or no row must not record.
          if (
            file.verifySql &&
            (await db.query(file.verifySql)).rows[0]?.ok !== true
          )
            throw new Error(
              'Post-migration verification did not return ok = true. Check index validity/definition before retrying.',
            )
          await db.query(
            `insert into ${TABLE} (name, checksum, execution_ms) values ($1, $2, $3)`,
            [file.name, file.checksum, Date.now() - start],
          )
          if (file.transaction) await db.query('COMMIT')
        } catch (error) {
          const failure = new Error(
            `${file.name} failed${file.transaction ? '' : '; nontransactional changes may remain'}.`,
            { cause: error },
          )
          if (!file.transaction) throw failure
          await throwAfter(failure, 'ROLLBACK', rollback)
        }
        log(`Applied ${file.name}`)
      }
      log('Database migrations are up to date.')
    },
    () => db.query(`select pg_advisory_unlock(${LOCK})`),
  )
}
