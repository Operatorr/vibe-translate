import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadMigrations,
  migrate,
  splitStatements,
  type Migration,
} from './db-migration-runner'
import { migrationConnection } from './db-migrate'

const file = (name: string, transaction = true): Migration => ({
  name,
  transaction,
  checksum: name,
  sql: `select '${name}';`,
})
function database(
  options: {
    populated?: boolean
    locked?: boolean
    fail?: string
    verify?: boolean
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = []
  const applied: Record<string, unknown>[] = []
  let exists = false
  let checkpoint: Record<string, unknown>[] | undefined
  return {
    calls,
    applied,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes('pg_try_advisory_lock'))
        return { rows: [{ locked: options.locked !== false }] }
      if (sql.includes('to_regclass'))
        return { rows: [{ table_name: exists ? 'schema_migrations' : null }] }
      if (sql.startsWith('select name, checksum')) return { rows: [...applied] }
      if (sql.includes('information_schema.tables'))
        return { rows: [{ populated: !!options.populated }] }
      if (sql.startsWith('create table')) exists = true
      if (sql === 'BEGIN') checkpoint = [...applied]
      if (sql === 'ROLLBACK') applied.splice(0, applied.length, ...checkpoint!)
      if (sql.includes('insert into public.schema_migrations'))
        applied.push({ name: params[0], checksum: params[1] })
      if (sql === options.fail) throw new Error('database failed')
      if (sql === 'verify') return { rows: [{ ok: options.verify !== false }] }
      return { rows: [] }
    },
  }
}

describe('migration execution and ownership', () => {
  it('commits each migration with its tracking row and does no work on rerun', async () => {
    const db = database()
    const files = [file('0001_first.sql'), file('0002_second.sql')]
    await migrate(db, files)
    const sql = db.calls.map((call) => call.sql)
    expect(sql.slice(sql.indexOf('BEGIN'), sql.indexOf('COMMIT') + 1)).toEqual([
      'BEGIN',
      files[0].sql,
      'insert into public.schema_migrations (name, checksum, execution_ms) values ($1, $2, $3)',
      'COMMIT',
    ])
    await migrate(db, files)
    expect(db.applied).toHaveLength(2)
    expect(db.calls.filter((call) => call.sql === files[0].sql)).toHaveLength(1)
  })
  it('rolls back a failed transaction, does not mark it applied, and releases the lock', async () => {
    const migration = file('0001_fail.sql')
    const db = database({ fail: migration.sql })
    await expect(migrate(db, [migration])).rejects.toThrow(
      '0001_fail.sql failed',
    )
    expect(db.applied).toEqual([])
    expect(db.calls.at(-2)?.sql).toBe('ROLLBACK')
    expect(db.calls.at(-1)?.sql).toContain('pg_advisory_unlock')
  })
  it('executes concurrent statements separately outside a transaction and verifies before tracking', async () => {
    const migration = {
      ...file('0008_index.sql', false),
      sql: 'create index concurrently a; create index concurrently b;',
      verifySql: 'verify',
    }
    const db = database()
    await migrate(db, [migration])
    expect(db.calls.some((call) => call.sql === 'BEGIN')).toBe(false)
    expect(db.calls.map((call) => call.sql)).toContain(
      'create index concurrently a;',
    )
    expect(db.calls.map((call) => call.sql)).toContain(
      'create index concurrently b;',
    )
    expect(db.applied).toHaveLength(1)
    const invalid = database({ verify: false })
    await expect(migrate(invalid, [migration])).rejects.toThrow(
      'nontransactional changes may remain',
    )
    expect(invalid.applied).toEqual([])
  })
  it('requires deliberate adoption of an existing untracked database and skips historical SQL', async () => {
    const db = database({ populated: true })
    const files = [file('0001_history.sql'), file('0002_forward.sql')]
    await expect(migrate(db, files)).rejects.toThrow('no tracked history')
    await migrate(db, files, { baseline: '0001' })
    expect(db.calls.some((call) => call.sql === files[0].sql)).toBe(false)
    expect(db.calls.some((call) => call.sql === files[1].sql)).toBe(true)
    await expect(migrate(db, files, { baseline: '0001' })).rejects.toThrow(
      'only allowed',
    )
  })
  it('rejects changed/missing history and old-number insertions before executing SQL', async () => {
    const db = database()
    const first = file('0001_first.sql')
    await migrate(db, [first])
    await expect(
      migrate(db, [{ ...first, checksum: 'changed' }]),
    ).rejects.toThrow('changed')
    await expect(migrate(db, [])).rejects.toThrow('missing')
    await expect(
      migrate(db, [file('0000_backfill.sql'), first]),
    ).rejects.toThrow('gap')
  })
  it('refuses a second runner and makes status read-only', async () => {
    const db = database({ locked: false })
    await expect(migrate(db, [file('0001.sql')])).rejects.toThrow(
      'Another migration runner',
    )
    expect(db.calls).toHaveLength(1)
    db.calls.length = 0
    const messages: string[] = []
    await migrate(db, [file('0001.sql')], {
      status: true,
      log: (message) => messages.push(message),
    })
    expect(messages).toEqual(['pending 0001.sql'])
    expect(db.calls).toHaveLength(1)
  })
})

describe('PostgreSQL SQL files', () => {
  it('rejects top-level transaction control before executing a migration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-parser-'))
    const metadata = join(directory, 'options.json')
    try {
      await writeFile(metadata, '{}')
      await writeFile(
        join(directory, '0001_explicit.sql'),
        '/* outer /* nested */ outer */ BEGIN; select 1; COMMIT;',
      )
      await expect(loadMigrations(directory, metadata)).rejects.toThrow(
        'runner owns transaction',
      )
      await writeFile(
        join(directory, '0001_explicit.sql'),
        'DO $$ BEGIN PERFORM 1; END $$;',
      )
      expect(await loadMigrations(directory, metadata)).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('preserves dollar blocks, escaped strings, quoted identifiers and nested comments', () => {
    const sql = `-- comment ;\nDO $body$ BEGIN PERFORM ';'; END $body$;\nselect 'a;''b', E'escaped\\';x', "semi;colon"; /* outer /* inner ; */ outer */ select 3; -- tail`
    const statements = splitStatements(sql)
    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain('END $body$;')
    expect(statements[1]).toContain('"semi;colon";')
    expect(splitStatements('; /* outer /* inner */ outer */ -- end')).toEqual(
      [],
    )
    expect(() => splitStatements("select 'unfinished")).toThrow('Unterminated')
  })
  it('loads the actual index migration as nontransactional without editing its SQL', async () => {
    const files = await loadMigrations(
      fileURLToPath(new URL('../db/migrations', import.meta.url)),
      fileURLToPath(new URL('../db/migrations.json', import.meta.url)),
    )
    expect(files).toHaveLength(8)
    const index = files.at(-1)!
    expect(index.transaction).toBe(false)
    expect(splitStatements(index.sql)).toHaveLength(1)
    expect(index.verifySql).toContain('i.indisvalid')
  })
})

describe('database targets', () => {
  const host = 'ep-production.neon.tech'
  const target = { productionHost: host, productionDatabase: 'neondb' }
  const local = {
    DATABASE_URL: 'postgres://user:secret@ep-local-pooler.neon.tech/neondb',
  }
  const prod = {
    PRODUCTION_DATABASE_URL: `postgres://user:secret@${host}/neondb`,
  }
  it('defaults to Local and uses the direct Neon endpoint with certificate verification', () => {
    const url = migrationConnection(false, {}, local, prod, target)
    expect(url.hostname).toBe('ep-local.neon.tech')
    expect(url.searchParams.get('sslmode')).toBe('verify-full')
  })
  it('never falls back to local credentials for production or uses production as Local', () => {
    expect(() => migrationConnection(true, {}, local, {}, target)).toThrow(
      'never falls back',
    )
    expect(() =>
      migrationConnection(
        false,
        { MIGRATION_DATABASE_URL: prod.PRODUCTION_DATABASE_URL },
        local,
        {},
        target,
      ),
    ).toThrow('requires --production')
    expect(() =>
      migrationConnection(
        true,
        {},
        {},
        { PRODUCTION_DATABASE_URL: local.DATABASE_URL },
        target,
      ),
    ).toThrow('does not match')
    expect(() =>
      migrationConnection(
        true,
        {},
        {},
        { PRODUCTION_DATABASE_URL: `postgres://user:secret@${host}/other` },
        target,
      ),
    ).toThrow('does not match')
    expect(migrationConnection(true, {}, local, prod, target).hostname).toBe(
      host,
    )
  })
})
