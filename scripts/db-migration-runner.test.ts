import { fileURLToPath } from 'node:url'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MIGRATION_LOCK,
  loadMigrations,
  migrate,
  splitStatements,
  type Migration,
} from './db-migration-runner'

const TRACK = 'insert into public.schema_migrations'
const UNLOCK = 'pg_advisory_unlock'
const file = (name: string, transaction = true): Migration => ({
  name,
  transaction,
  checksum: name,
  sql: `select '${name}';`,
})
// Models committed vs open-transaction tracker rows, the session lock, and
// injected failures. PostgreSQL ends the transaction when COMMIT fails.
function database(
  options: {
    populated?: boolean
    locked?: boolean
    fail?: (sql: string, params: unknown[]) => boolean
    verify?: Record<string, unknown>[]
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = []
  let tracker = false
  let open: Record<string, unknown>[] | undefined
  const db = {
    calls,
    error: new Error('database failed'),
    applied: [] as Record<string, unknown>[],
    held: false,
    sql: (from = 0) => calls.slice(from).map((call) => call.sql),
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (options.fail?.(sql, params)) {
        if (sql === 'COMMIT') open = undefined
        throw db.error
      }
      if (sql.includes('pg_try_advisory_lock')) {
        db.held = options.locked !== false
        return { rows: [{ locked: db.held }] }
      }
      if (sql.includes(UNLOCK)) db.held = false
      if (sql.includes('to_regclass'))
        return { rows: [{ table_name: tracker ? 'schema_migrations' : null }] }
      if (sql.startsWith('select name, checksum'))
        return { rows: [...(open ?? db.applied)] }
      if (sql.includes('information_schema.tables'))
        return { rows: [{ populated: !!options.populated }] }
      if (sql.startsWith('create table')) tracker = true
      if (sql === 'BEGIN') open = [...db.applied]
      if (sql === 'COMMIT') {
        db.applied = open!
        open = undefined
      }
      if (sql === 'ROLLBACK') open = undefined
      if (sql.startsWith(TRACK))
        (open ?? db.applied).push({ name: params[0], checksum: params[1] })
      if (sql === 'verify') return { rows: options.verify ?? [{ ok: true }] }
      return { rows: [] }
    },
  }
  return db
}
async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('Expected a rejection')
}
// Nothing that executes or records a migration was sent.
function expectNoMigrationWork(sql: string[], files: Migration[]) {
  expect(sql).not.toContain('BEGIN')
  expect(sql.filter((statement) => statement.startsWith(TRACK))).toEqual([])
  for (const migration of files) expect(sql).not.toContain(migration.sql)
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
// Writes SQL files and metadata to a fresh temporary directory.
async function fixture(files: Record<string, string>, metadata: unknown = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'migrations-'))
  directories.push(directory)
  for (const [name, sql] of Object.entries(files))
    await writeFile(join(directory, name), sql)
  const metadataPath = join(directory, 'migrations.json')
  await writeFile(metadataPath, JSON.stringify(metadata))
  return () => loadMigrations(directory, metadataPath)
}

describe('migration execution and ownership', () => {
  it('commits each migration with its tracking row and does no work on rerun', async () => {
    const db = database()
    const files = [file('0001_first.sql'), file('0002_second.sql')]
    await migrate(db, files)
    const sql = db.sql()
    expect(sql.slice(sql.indexOf('BEGIN'), sql.indexOf('COMMIT') + 1)).toEqual([
      'BEGIN',
      files[0].sql,
      'insert into public.schema_migrations (name, checksum, execution_ms) values ($1, $2, $3)',
      'COMMIT',
    ])
    await migrate(db, files)
    expect(db.applied).toHaveLength(2)
    expect(db.sql().filter((call) => call === files[0].sql)).toHaveLength(1)
    expect(db.held).toBe(false)
  })
  it('rolls back a failed migration, keeps its name and cause, and releases the lock', async () => {
    const migration = file('0001_fail.sql')
    const db = database({ fail: (sql) => sql === migration.sql })
    const error = await rejection(migrate(db, [migration]))
    expect(error.message).toBe('0001_fail.sql failed.')
    expect(error.cause).toBe(db.error)
    expect(db.applied).toEqual([])
    expect(db.sql().at(-2)).toBe('ROLLBACK')
    expect(db.sql().at(-1)).toContain(UNLOCK)
    expect(db.held).toBe(false)
  })
  it.each([
    [
      'tracking INSERT',
      (sql: string, params: unknown[]) =>
        sql.startsWith(TRACK) && params[0] === '0002_second.sql',
    ],
    [
      'COMMIT',
      (() => {
        let commits = 0
        return (sql: string) => sql === 'COMMIT' && ++commits === 2
      })(),
    ],
  ])(
    'rolls back when the %s fails without committing its tracking row',
    async (_, fail) => {
      const files = [file('0001_first.sql'), file('0002_second.sql')]
      const db = database({ fail })
      const error = await rejection(migrate(db, files))
      expect(error.message).toBe('0002_second.sql failed.')
      expect(error.cause).toBe(db.error)
      expect(db.applied.map((row) => row.name)).toEqual(['0001_first.sql'])
      const sql = db.sql()
      expect(sql.slice(sql.lastIndexOf('BEGIN')).slice(-2)).toEqual([
        'ROLLBACK',
        `select ${UNLOCK}(${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.id})`,
      ])
      expect(db.held).toBe(false)
    },
  )
  it('keeps the migration failure when ROLLBACK and unlock also fail', async () => {
    const migration = file('0001_fail.sql')
    const db = database({
      fail: (sql) =>
        sql === migration.sql || sql === 'ROLLBACK' || sql.includes(UNLOCK),
    })
    const error = await rejection(migrate(db, [migration]))
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.message).toBe(
      '0001_fail.sql failed. ROLLBACK also failed. Advisory unlock also failed.',
    )
    const [cleanup, unlock] = (error as AggregateError).errors
    expect(unlock.message).toBe('Advisory unlock failed.')
    expect(unlock.cause).toBe(db.error)
    const [failure, rollback] = (cleanup as AggregateError).errors
    expect(failure.message).toBe('0001_fail.sql failed.')
    expect(failure.cause).toBe(db.error)
    expect(rollback.message).toBe('ROLLBACK failed.')
    expect(rollback.cause).toBe(db.error)
  })
  it('throws an unlock failure on its own only when nothing else failed', async () => {
    const db = database({ fail: (sql) => sql.includes(UNLOCK) })
    const error = await rejection(migrate(db, [file('0001_first.sql')]))
    expect(error.message).toBe('Advisory unlock failed.')
    expect(error.cause).toBe(db.error)
    expect(db.applied).toHaveLength(1)
  })
  it('executes concurrent statements separately outside a transaction and verifies before tracking', async () => {
    const migration = {
      ...file('0008_index.sql', false),
      sql: 'create index concurrently a; create index concurrently b;',
      verifySql: 'verify',
    }
    const db = database()
    await migrate(db, [migration])
    const sql = db.sql()
    expect(sql).not.toContain('BEGIN')
    expect(sql).toContain('create index concurrently a;')
    expect(sql).toContain('create index concurrently b;')
    expect(sql.indexOf('verify')).toBeLessThan(
      sql.findIndex((statement) => statement.startsWith(TRACK)),
    )
    expect(db.applied).toHaveLength(1)
  })
  it.each([
    ['false', [{ ok: false }]],
    ["text 'false'", [{ ok: 'false' }]],
    ["text 'true'", [{ ok: 'true' }]],
    ['1', [{ ok: 1 }]],
    ['NULL', [{ ok: null }]],
    ['no rows', []],
    ['no ok column', [{ valid: true }]],
  ])(
    'does not record a migration whose verification returns %s',
    async (_, rows) => {
      const migration = {
        ...file('0008_index.sql', false),
        verifySql: 'verify',
      }
      const db = database({ verify: rows })
      const error = await rejection(migrate(db, [migration]))
      expect(error.message).toBe(
        '0008_index.sql failed; nontransactional changes may remain.',
      )
      expect((error.cause as Error).message).toContain('ok = true')
      expect(db.applied).toEqual([])
      expect(db.held).toBe(false)
    },
  )
  it('requires deliberate adoption of an existing untracked database and skips historical SQL', async () => {
    const db = database({ populated: true })
    const files = [file('0001_history.sql'), file('0002_forward.sql')]
    await expect(migrate(db, files)).rejects.toThrow('no tracked history')
    expectNoMigrationWork(db.sql(), files)
    await migrate(db, files, { baseline: '0001' })
    expect(db.sql()).not.toContain(files[0].sql)
    expect(db.sql()).toContain(files[1].sql)
    expect(db.applied.map((row) => row.name)).toEqual([
      '0001_history.sql',
      '0002_forward.sql',
    ])
    await expect(migrate(db, files, { baseline: '0001' })).rejects.toThrow(
      'only allowed',
    )
  })
  it.each([
    ['an empty database', false, '0001', 'Cannot baseline an empty database'],
    ['an unknown migration', true, '0009', 'Unknown baseline: "0009"'],
    ['an empty baseline', true, '', 'Unknown baseline: ""'],
  ])(
    'rejects a baseline of %s before tracking anything',
    async (_, populated, baseline, message) => {
      const db = database({ populated })
      const files = [file('0001_history.sql'), file('0002_forward.sql')]
      await expect(migrate(db, files, { baseline })).rejects.toThrow(message)
      expectNoMigrationWork(db.sql(), files)
      expect(db.sql().some((sql) => sql.startsWith('create table'))).toBe(false)
      expect(db.applied).toEqual([])
      expect(db.held).toBe(false)
    },
  )
  it('rolls back a partial baseline without replaying history', async () => {
    const files = [
      file('0001_history.sql'),
      file('0002_history.sql'),
      file('0003_forward.sql'),
    ]
    const db = database({
      populated: true,
      fail: (sql, params) =>
        sql.startsWith(TRACK) && params[0] === files[1].name,
    })
    const error = await rejection(migrate(db, files, { baseline: '0002' }))
    expect(error).toBe(db.error)
    const sql = db.sql()
    expect(sql.filter((statement) => statement.startsWith(TRACK))).toHaveLength(
      2,
    )
    expect(sql.slice(-2)).toEqual([
      'ROLLBACK',
      `select ${UNLOCK}(${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.id})`,
    ])
    for (const migration of files) expect(sql).not.toContain(migration.sql)
    expect(db.applied).toEqual([])
    expect(db.held).toBe(false)
  })
  it('rejects changed/missing history and old-number insertions before executing SQL', async () => {
    const db = database()
    const first = file('0001_first.sql')
    const next = file('0002_next.sql')
    await migrate(db, [first])
    const cases: [Migration[], string][] = [
      [[{ ...first, checksum: 'changed' }, next], 'Applied migration changed'],
      [[next], 'Applied migration file is missing'],
      [[file('0000_backfill.sql'), first, next], 'gap'],
    ]
    for (const [files, message] of cases) {
      const from = db.calls.length
      await expect(migrate(db, files)).rejects.toThrow(message)
      expectNoMigrationWork(db.sql(from), [...files, first])
      expect(db.held).toBe(false)
    }
    expect(db.applied.map((row) => row.name)).toEqual(['0001_first.sql'])
  })
  it('refuses a second runner and makes status read-only', async () => {
    const db = database({ locked: false })
    await expect(migrate(db, [file('0001.sql')])).rejects.toThrow(
      'Another migration runner',
    )
    expect(db.sql()).toEqual([
      `select pg_try_advisory_lock(${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.id}) as locked`,
    ])
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
    for (const sql of [
      '/* outer /* nested */ outer */ BEGIN; select 1; COMMIT;',
      'select 1; release my_savepoint;',
      'begin; select 1; end;',
    ])
      await expect(
        (await fixture({ '0001_explicit.sql': sql }))(),
      ).rejects.toThrow('runner owns transaction')
    expect(
      await (
        await fixture({ '0001_block.sql': 'DO $$ BEGIN PERFORM 1; END $$;' })
      )(),
    ).toHaveLength(1)
  })
  it('ends line comments at CR as well as LF', async () => {
    for (const newline of ['\r', '\r\n']) {
      expect(splitStatements(`-- note;${newline}select 1;`)).toEqual([
        `-- note;${newline}select 1;`,
      ])
      const migration = {
        ...file('0001_index.sql', false),
        sql: `-- note;${newline}create index concurrently a on t (x);`,
      }
      const db = database()
      await migrate(db, [migration])
      expect(db.sql()).toContain(migration.sql)
      await expect(
        (await fixture({ '0001_explicit.sql': `-- note${newline}COMMIT;` }))(),
      ).rejects.toThrow('runner owns transaction')
    }
  })
  it('splits only top-level statements', () => {
    expect(
      splitStatements(
        `-- comment ;\nDO $body$ BEGIN PERFORM ';'; END $body$;\nselect 'a;''b', E'escaped\\';x', "semi;colon"; /* outer /* inner ; */ outer */ select 3; -- tail`,
      ),
    ).toEqual([
      "-- comment ;\nDO $body$ BEGIN PERFORM ';'; END $body$;",
      `select 'a;''b', E'escaped\\';x', "semi;colon";`,
      '/* outer /* inner ; */ outer */ select 3;',
    ])
    expect(splitStatements('select "a"";b" from "x;y"; select 2')).toEqual([
      'select "a"";b" from "x;y";',
      'select 2',
    ])
    expect(splitStatements('/* a /* b; */ still; */ select 1;')).toEqual([
      '/* a /* b; */ still; */ select 1;',
    ])
    expect(splitStatements('; /* outer /* inner */ outer */ -- end')).toEqual(
      [],
    )
    for (const sql of [
      "select 'unfinished",
      'select $a$ body; select 1;',
      'select "open; select 1;',
      '/* a /* b */ select 1;',
    ])
      expect(() => splitStatements(sql)).toThrow('Unterminated')
  })
  it('recognizes Unicode dollar tags and identifiers that contain $', () => {
    expect(
      splitStatements(
        "DO $日本語$ BEGIN PERFORM ';'; PERFORM 2; END $日本語$; select 2;",
      ),
    ).toEqual([
      "DO $日本語$ BEGIN PERFORM ';'; PERFORM 2; END $日本語$;",
      'select 2;',
    ])
    expect(
      splitStatements('select 名前$x$; select col$tag$, $1; select 2;'),
    ).toEqual(['select 名前$x$;', 'select col$tag$, $1;', 'select 2;'])
  })
  it('keeps SQL-standard BEGIN ATOMIC routine bodies whole', async () => {
    const fn =
      'create function clamp(x int) returns int language sql\nbegin atomic\n  select 1;\n  select case when x > 0 then x else 0 end;\nend;'
    const procedure =
      'CREATE OR REPLACE PROCEDURE fill() LANGUAGE sql BEGIN ATOMIC insert into t values (1); insert into t values (2); END;'
    expect(splitStatements(`${fn}\n${procedure}\nselect 2;`)).toEqual([
      fn,
      procedure,
      'select 2;',
    ])
    expect(
      await (
        await fixture({ '0001_routines.sql': `${fn}\n${procedure}` })
      )(),
    ).toHaveLength(1)
  })
  it('detects concurrent DDL in executable SQL only', async () => {
    const prose = [
      '-- create index concurrently happens in a later file',
      '/* drop index concurrently x; */',
      "select 'create index concurrently';",
      "do $$ begin raise notice 'reindex index concurrently'; end $$;",
      'select 1 as "create index concurrently";',
    ].join('\n')
    expect(await (await fixture({ '0001_prose.sql': prose }))()).toHaveLength(1)
    for (const sql of [
      'create index concurrently a on t (x);',
      'CREATE UNIQUE INDEX\nCONCURRENTLY a on t (x);',
      'drop index /* why */ concurrently a;',
      'reindex index concurrently a;',
      'reindex (verbose) table concurrently t;',
      'alter table t detach partition p concurrently;',
    ]) {
      await expect(
        (await fixture({ '0001_index.sql': sql }))(),
      ).rejects.toThrow('Declare transaction: false')
      const [loaded] = await (
        await fixture(
          { '0001_index.sql': sql },
          { '0001_index.sql': { transaction: false } },
        )
      )()
      expect(loaded.transaction).toBe(false)
    }
  })
  it.each([
    ['a three-digit number', { '001_short.sql': 'select 1;' }],
    ['a dash separator', { '0001-dash.sql': 'select 1;' }],
    ['an uppercase slug', { '0001_Upper.sql': 'select 1;' }],
    [
      'a duplicate number',
      { '0001_a.sql': 'select 1;', '0001_b.sql': 'select 2;' },
    ],
  ])('rejects a file name with %s', async (_, files) => {
    await expect((await fixture(files))()).rejects.toThrow(
      'Invalid or duplicate migration number',
    )
  })
  it.each([
    ['a missing file', { '0002_missing.sql': {} }, 'missing migration'],
    ['a non-object entry', { '0001_a.sql': true }, 'Invalid migration options'],
    [
      'an unknown option',
      { '0001_a.sql': { transactional: false } },
      'Invalid migration options',
    ],
    [
      'a string transaction flag',
      { '0001_a.sql': { transaction: 'false' } },
      'Invalid transaction setting',
    ],
    [
      'non-string verification SQL',
      { '0001_a.sql': { verifySql: 1 } },
      'Invalid verification SQL',
    ],
    [
      'blank verification SQL',
      { '0001_a.sql': { verifySql: ' ' } },
      'Invalid verification SQL',
    ],
    ['a non-object root', [], 'must be a JSON object'],
  ])('rejects metadata with %s', async (_, metadata, message) => {
    await expect(
      (await fixture({ '0001_a.sql': 'select 1;' }, metadata))(),
    ).rejects.toThrow(message)
  })
  it('derives stable checksums from SQL and effective options', async () => {
    const checksum = async (sql: string, options?: object) =>
      (
        await (
          await fixture(
            { '0001_a.sql': sql },
            options ? { '0001_a.sql': options } : {},
          )
        )()
      )[0].checksum
    // Recorded history depends on this exact formula; changing it breaks every database.
    const base = await checksum('select 1;')
    expect(base).toBe(
      'f1c4a814fef762ab7d9e6b1fda2e1b8d2e872f13ec84aad7bb1ab816094eea04',
    )
    expect(await checksum('select 1;', { transaction: true })).toBe(base)
    const variants = [
      await checksum('select 2;'),
      await checksum('select 1;', { transaction: false }),
      await checksum('select 1;', { verifySql: 'select true as ok' }),
    ]
    expect(new Set([base, ...variants]).size).toBe(4)
  })
  it('loads every real migration and keeps 0008 nontransactional without editing its SQL', async () => {
    const directory = fileURLToPath(
      new URL('../db/migrations', import.meta.url),
    )
    const files = await loadMigrations(
      directory,
      fileURLToPath(new URL('../db/migrations.json', import.meta.url)),
    )
    expect(files.map((migration) => migration.name)).toEqual(
      (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort(),
    )
    const index = files.find(
      (migration) => migration.name === '0008_segment_pagination.sql',
    )
    expect(index?.transaction).toBe(false)
    expect(splitStatements(index!.sql)).toHaveLength(1)
    expect(index?.verifySql).toContain('i.indisvalid')
  })
})
