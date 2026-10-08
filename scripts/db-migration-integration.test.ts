import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { localDatabaseUrl, migrationClient } from './db-migrate'
import {
  MIGRATION_LOCK,
  loadMigrations,
  migrate,
  withCleanup,
  type Migration,
} from './db-migration-runner'

const LOCK = `${MIGRATION_LOCK.namespace}, ${MIGRATION_LOCK.id}`

// Creates and drops one disposable DATABASE on Local. Never touches app tables.
describe.runIf(process.env.RUN_LOCAL_DB_MIGRATIONS === '1')(
  'local migration integration',
  () => {
    it('bootstraps, tracks, locks, rolls back, and rejects invalid concurrent indexes', async () => {
      // Resolved like `pnpm db:migrate`; refuses Production and APP_ENV=production.
      const url = localDatabaseUrl()
      const connect = (target: URL) =>
        migrationClient(target, { connectionTimeoutMillis: 15_000 })
      const name = `migration_test_${randomUUID().replaceAll('-', '')}`
      const scratchUrl = new URL(url)
      scratchUrl.pathname = `/${name}`
      const admin = connect(url)
      const db = connect(scratchUrl)
      const other = connect(scratchUrl)
      const files = await loadMigrations(
        fileURLToPath(new URL('../db/migrations', import.meta.url)),
        fileURLToPath(new URL('../db/migrations.json', import.meta.url)),
      )
      // Synthetic files take unused numbers after the real history.
      const last = Number(files.at(-1)!.name.slice(0, 4))
      const fixtureName = (offset: number, slug: string) =>
        `${String(last + offset).padStart(4, '0')}_${slug}.sql`
      const tracked = async () =>
        (
          await db.query(
            'select count(*)::int as n from public.schema_migrations',
          )
        ).rows[0].n
      let created = false
      await withCleanup(
        'Fixture cleanup',
        async () => {
          await admin.connect()
          await admin.query(`create database "${name}"`)
          created = true
          await db.connect()
          await other.connect()
          await migrate(db, files)
          const before = (
            await db.query(
              'select name,checksum,applied_at from public.schema_migrations order by name',
            )
          ).rows
          expect(before).toHaveLength(files.length)
          await migrate(db, files)
          expect(
            (
              await db.query(
                'select name,checksum,applied_at from public.schema_migrations order by name',
              )
            ).rows,
          ).toEqual(before)
          await db.query(`select pg_advisory_lock(${LOCK})`)
          await expect(migrate(other, files)).rejects.toThrow(
            'Another migration runner',
          )
          await db.query(`select pg_advisory_unlock(${LOCK})`)
          const failed: Migration = {
            name: fixtureName(1, 'rollback_probe'),
            sql: 'create table rollback_probe(id int); select 1/0;',
            checksum: 'rollback',
            transaction: true,
          }
          await expect(migrate(db, [...files, failed])).rejects.toThrow(
            'failed',
          )
          expect(
            (
              await db.query(
                "select to_regclass('public.rollback_probe') as name",
              )
            ).rows[0].name,
          ).toBeNull()
          expect(await tracked()).toBe(files.length)

          await db.query(
            'create table concurrent_probe(id int); insert into concurrent_probe values(1),(1)',
          )
          const concurrent: Migration = {
            name: fixtureName(2, 'concurrent_probe'),
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
          expect(await tracked()).toBe(files.length)
          await db.query('drop index concurrently public.concurrent_probe_uniq')
          await db.query(
            'truncate concurrent_probe; insert into concurrent_probe values(1)',
          )
          await migrate(db, [...files, concurrent])
          expect(await tracked()).toBe(files.length + 1)
        },
        // Attempt every step even after one fails; withCleanup keeps the test's
        // own failure first and attaches these.
        async () => {
          const errors = (
            await Promise.allSettled([db.end(), other.end()])
          ).flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          )
          try {
            // FORCE also disconnects a scratch client that failed to close.
            if (created)
              await admin.query(
                `drop database if exists "${name}" with (force)`,
              )
          } catch (error) {
            errors.push(error)
          } finally {
            await admin.end().catch((error: unknown) => errors.push(error))
          }
          if (errors.length)
            throw new AggregateError(errors, 'Fixture cleanup steps failed.')
        },
      )
    }, 120_000)
  },
)
