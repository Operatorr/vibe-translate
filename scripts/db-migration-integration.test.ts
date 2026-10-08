import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { migrationConnection } from './db-migrate'
import { loadMigrations, migrate, type Migration } from './db-migration-runner'
import targets from '../db/targets.json'

// Creates and drops one disposable DATABASE on Local. Never touches app tables.
describe.runIf(process.env.RUN_LOCAL_DB_MIGRATIONS === '1')(
  'local migration integration',
  () => {
    it('bootstraps, tracks, locks, rolls back, and rejects invalid concurrent indexes', async () => {
      if (process.env.APP_ENV === 'production')
        throw new Error('Refusing production fixtures')
      const url = migrationConnection(
        false,
        {
          MIGRATION_DATABASE_URL:
            process.env
              .CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
            process.env.DATABASE_URL,
        },
        {},
        {},
        targets,
      )
      const admin = new Client({ connectionString: url.toString() })
      const name = `migration_test_${randomUUID().replaceAll('-', '')}`
      const scratchUrl = new URL(url)
      scratchUrl.pathname = `/${name}`
      const db = new Client({ connectionString: scratchUrl.toString() })
      const other = new Client({ connectionString: scratchUrl.toString() })
      let created = false
      await admin.connect()
      try {
        await admin.query(`create database "${name}"`)
        created = true
        await db.connect()
        await other.connect()
        const files = await loadMigrations(
          fileURLToPath(new URL('../db/migrations', import.meta.url)),
          fileURLToPath(new URL('../db/migrations.json', import.meta.url)),
        )
        await migrate(db, files)
        const before = (
          await db.query(
            'select name,checksum,applied_at from public.schema_migrations order by name',
          )
        ).rows
        expect(before).toHaveLength(8)
        await migrate(db, files)
        expect(
          (
            await db.query(
              'select name,checksum,applied_at from public.schema_migrations order by name',
            )
          ).rows,
        ).toEqual(before)
        await db.query('select pg_advisory_lock(21474001,1)')
        await expect(migrate(other, files)).rejects.toThrow(
          'Another migration runner',
        )
        await db.query('select pg_advisory_unlock(21474001,1)')
        const failed: Migration = {
          name: '0009_rollback.sql',
          sql: 'create table rollback_probe(id int); select 1/0;',
          checksum: 'rollback',
          transaction: true,
        }
        await expect(migrate(db, [...files, failed])).rejects.toThrow('failed')
        expect(
          (
            await db.query(
              "select to_regclass('public.rollback_probe') as name",
            )
          ).rows[0].name,
        ).toBeNull()
        expect(
          (
            await db.query(
              'select count(*)::int as n from public.schema_migrations',
            )
          ).rows[0].n,
        ).toBe(8)

        await db.query(
          'create table concurrent_probe(id int); insert into concurrent_probe values(1),(1)',
        )
        const concurrent: Migration = {
          name: '0009_concurrent_probe.sql',
          sql: 'create unique index concurrently if not exists concurrent_probe_uniq on public.concurrent_probe(id);',
          checksum: 'concurrent',
          transaction: false,
          verifySql:
            "select exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='concurrent_probe_uniq' and i.indisvalid) as ok",
        }
        await expect(migrate(db, [...files, concurrent])).rejects.toThrow(
          'nontransactional',
        )
        // PostgreSQL left an invalid index. IF NOT EXISTS on retry must not mark it applied.
        await expect(migrate(db, [...files, concurrent])).rejects.toThrow(
          'nontransactional',
        )
        expect(
          (
            await db.query(
              'select count(*)::int as n from public.schema_migrations',
            )
          ).rows[0].n,
        ).toBe(8)
        await db.query('drop index concurrently public.concurrent_probe_uniq')
        await db.query(
          'truncate concurrent_probe; insert into concurrent_probe values(1)',
        )
        await migrate(db, [...files, concurrent])
        expect(
          (
            await db.query(
              'select count(*)::int as n from public.schema_migrations',
            )
          ).rows[0].n,
        ).toBe(9)
      } finally {
        await Promise.all([db.end(), other.end()])
        if (created) await admin.query(`drop database "${name}"`)
        await admin.end()
      }
    }, 120_000)
  },
)
