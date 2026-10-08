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
const LOCK = '21474001, 1'

// PostgreSQL strings, quoted identifiers, dollar bodies and nested comments
// can contain semicolons. Only split top-level statements for nontransactional DDL.
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let hasCode = false
  let quote = ''
  let escaped = false
  let dollar = ''
  let block = 0
  let line = false
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]
    if (line) {
      if (char === '\n') line = false
      continue
    }
    if (block) {
      if (char === '/' && next === '*') {
        block++
        i++
      } else if (char === '*' && next === '/') {
        block--
        i++
      }
      continue
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1
        dollar = ''
      }
      continue
    }
    if (quote) {
      if (escaped && char === '\\') {
        i++
        continue
      }
      if (char === quote) {
        if (next === quote) i++
        else quote = ''
      }
      continue
    }
    if (char === '-' && next === '-') {
      line = true
      i++
      continue
    }
    if (char === '/' && next === '*') {
      block = 1
      i++
      continue
    }
    if (char === "'" || char === '"') {
      hasCode = true
      quote = char
      escaped =
        char === "'" &&
        /[eE]/.test(sql[i - 1] ?? '') &&
        !/[\w$]/.test(sql[i - 2] ?? '')
      continue
    }
    if (char === '$' && !/[\w$]/.test(sql[i - 1] ?? '')) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)?.[0]
      if (tag) {
        hasCode = true
        dollar = tag
        i += tag.length - 1
        continue
      }
    }
    if (char === ';') {
      if (hasCode) statements.push(sql.slice(start, i + 1).trim())
      hasCode = false
      start = i + 1
    } else if (!/\s/.test(char)) hasCode = true
  }
  if (quote || dollar || block)
    throw new Error('Unterminated SQL quote or comment')
  if (hasCode) statements.push(sql.slice(start).trim())
  return statements
}

function statementCode(statement: string) {
  let code = statement.trimStart()
  while (code.startsWith('--') || code.startsWith('/*')) {
    if (code.startsWith('--')) {
      const end = code.indexOf('\n')
      code = end < 0 ? '' : code.slice(end + 1).trimStart()
    } else {
      let depth = 1
      let i = 2
      while (depth && i < code.length) {
        if (code.startsWith('/*', i)) {
          depth++
          i += 2
        } else if (code.startsWith('*/', i)) {
          depth--
          i += 2
        } else i++
      }
      code = code.slice(i).trimStart()
    }
  }
  return code
}

export async function loadMigrations(
  directory: string,
  metadataPath: string,
): Promise<Migration[]> {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<
    string,
    MigrationOptions
  >
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
  for (const name of Object.keys(metadata))
    if (!names.includes(name))
      throw new Error(`Metadata references missing migration: ${name}`)
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8')
      if (
        splitStatements(sql).some((statement) =>
          /^(?:begin|commit|rollback|end|abort|savepoint|release\s+savepoint|start\s+transaction|prepare\s+transaction)\b/i.test(
            statementCode(statement),
          ),
        )
      )
        throw new Error(
          `The runner owns transaction control; remove it from ${name}`,
        )
      const options = metadata[name] ?? {}
      if (
        options.transaction !== undefined &&
        typeof options.transaction !== 'boolean'
      )
        throw new Error(`Invalid transaction setting: ${name}`)
      if (
        options.verifySql !== undefined &&
        typeof options.verifySql !== 'string'
      )
        throw new Error(`Invalid verification SQL: ${name}`)
      const transaction = options.transaction !== false
      if (
        transaction &&
        /\b(?:create\s+(?:unique\s+)?index|drop\s+index|reindex)\s+concurrently\b/i.test(
          sql,
        )
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
  try {
    await db.query("set lock_timeout = '5s'")
    await db.query("set statement_timeout = '30min'")
    let applied = await history(db)
    checkHistory(migrations, applied)
    const existing = await db.query(
      "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations') as populated",
    )
    if (!applied.length && existing.rows[0]?.populated && !options.baseline)
      throw new Error(
        'Existing database has no tracked history. Audit its schema, then run --baseline 000N once; historical SQL will not be replayed.',
      )
    let baseline: Migration[] = []
    if (options.baseline) {
      if (applied.length)
        throw new Error(
          'Baseline is only allowed before any migration is tracked.',
        )
      if (!existing.rows[0]?.populated)
        throw new Error(
          'Cannot baseline an empty database; run migrations normally.',
        )
      const index = migrations.findIndex(
        (file) =>
          file.name === options.baseline ||
          file.name.slice(0, 4) === options.baseline,
      )
      if (index < 0) throw new Error(`Unknown baseline: ${options.baseline}`)
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
        await db.query('ROLLBACK')
        throw error
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
        if (file.verifySql && !(await db.query(file.verifySql)).rows[0]?.ok)
          throw new Error(
            'Post-migration verification failed. Check index validity/definition before retrying.',
          )
        await db.query(
          `insert into ${TABLE} (name, checksum, execution_ms) values ($1, $2, $3)`,
          [file.name, file.checksum, Date.now() - start],
        )
        if (file.transaction) await db.query('COMMIT')
      } catch (error) {
        if (file.transaction) await db.query('ROLLBACK')
        throw new Error(
          `${file.name} failed${file.transaction ? '' : '; nontransactional changes may remain'}.`,
          { cause: error },
        )
      }
      log(`Applied ${file.name}`)
    }
    log('Database migrations are up to date.')
  } finally {
    await db.query(`select pg_advisory_unlock(${LOCK})`)
  }
}
