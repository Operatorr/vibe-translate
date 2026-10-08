import { describe, expect, it } from 'vitest'
import targets from '../db/targets.json'
import {
  errorMessages,
  localDatabaseUrl,
  migrationClient,
  migrationConnection,
} from './db-migrate'

const host = 'ep-production.c-2.ap-southeast-1.aws.neon.tech'
const target = { productionHost: host, productionDatabase: 'neondb' }
const local = {
  DATABASE_URL:
    'postgres://user:secret@ep-local-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb',
}
const prod = {
  PRODUCTION_DATABASE_URL: `postgres://user:secret@${host}/neondb`,
}
const asLocal = (url: string) =>
  migrationConnection(false, { MIGRATION_DATABASE_URL: url }, {}, {}, target)
const asProduction = (url: string) =>
  migrationConnection(true, { PRODUCTION_DATABASE_URL: url }, {}, {}, target)

describe('database targets', () => {
  it('defaults to Local and uses the direct Neon endpoint with certificate verification', () => {
    const url = migrationConnection(false, {}, local, prod, target)
    expect(url.hostname).toBe('ep-local.c-2.ap-southeast-1.aws.neon.tech')
    expect(url.port).toBe('5432')
    expect(url.searchParams.get('sslmode')).toBe('verify-full')
  })
  it('never falls back to local credentials for production or uses production as Local', () => {
    expect(() => migrationConnection(true, {}, local, {}, target)).toThrow(
      'never falls back',
    )
    expect(() => asLocal(prod.PRODUCTION_DATABASE_URL)).toThrow(
      'requires --production',
    )
    expect(() => asProduction(local.DATABASE_URL)).toThrow('does not match')
    expect(() => asProduction(`postgres://user:secret@${host}/other`)).toThrow(
      'does not match',
    )
    expect(migrationConnection(true, {}, local, prod, target).hostname).toBe(
      host,
    )
  })
  it('rejects query parameters that pg would use to re-route the connection', () => {
    for (const parameter of [
      `host=${host}`,
      'host=%2Ftmp',
      'hostaddr=10.0.0.1',
      'port=6543',
      'dbname=neondb',
      'database=neondb',
      'user=admin',
      'password=other',
      'options=endpoint%3Dep-production',
      'ssl=0',
      'sslrootcert=%2Ftmp%2Fca.pem',
      'uselibpqcompat=true',
    ]) {
      expect(() =>
        asLocal(
          `postgres://user:secret@ep-local.neon.tech/neondb?${parameter}`,
        ),
      ).toThrow('Remove')
      expect(() =>
        asProduction(`postgres://user:secret@${host}/neondb?${parameter}`),
      ).toThrow('Remove')
    }
    const url = asLocal(
      'postgres://user:secret@ep-local.neon.tech/neondb?sslmode=require&channel_binding=require&application_name=migrate',
    )
    expect(url.searchParams.get('sslmode')).toBe('verify-full')
    expect(url.searchParams.get('channel_binding')).toBe('require')
  })
  it('compares canonical host names, so case, a root dot, the pooler or another alias cannot reach Production as Local', () => {
    for (const alias of [
      host.toUpperCase(),
      'EP-Production.C-2.ap-southeast-1.AWS.neon.tech',
      `${host}.`,
      'ep-production-pooler.c-2.ap-southeast-1.aws.neon.tech',
      'ep-production.ap-southeast-1.aws.neon.tech',
    ])
      expect(() => asLocal(`postgres://user:secret@${alias}/neondb`)).toThrow(
        'requires --production',
      )
    expect(
      asProduction(`postgres://user:secret@${host.toUpperCase()}./neondb`)
        .hostname,
    ).toBe(host)
    expect(
      asProduction(
        'postgres://user:secret@EP-Production-Pooler.c-2.ap-southeast-1.aws.neon.tech/neondb',
      ).hostname,
    ).toBe(host)
    expect(asLocal('postgres://user:secret@DB.Example./app').toString()).toBe(
      'postgres://user:secret@db.example:5432/app',
    )
  })
  it('allows Production only on the configured host and database', () => {
    for (const url of [
      'postgres://user:secret@ep-other.c-2.ap-southeast-1.aws.neon.tech/neondb',
      `postgres://user:secret@${host}.evil.example/neondb`,
      `postgres://user:secret@${host}/neondb2`,
      `postgres://user:secret@${host}/`,
    ])
      expect(() => asProduction(url)).toThrow()
  })
  it('rejects socket paths, missing hosts and missing databases', () => {
    for (const url of [
      'postgres://user:secret@%2Ftmp%2F.s.PGSQL.5432/neondb',
      'postgres:///neondb',
      'socket://user:secret@/tmp?db=neondb',
      'postgres://user:secret@db.example',
      'not a url',
    ])
      expect(() => asLocal(url)).toThrow()
    expect(() =>
      asLocal('postgres://user:secret@db-pooler.example/app'),
    ).toThrow('direct database connection')
  })
  it('builds clients only for the validated target', () => {
    const url = asLocal('postgres://user:secret@db.example:6000/app')
    const client = migrationClient(url)
    expect([client.host, client.port, client.database]).toEqual([
      'db.example',
      6000,
      'app',
    ])
    url.searchParams.set('host', host)
    expect(() => migrationClient(url)).toThrow('effective connection target')
  })
})

describe('Local configuration selection', () => {
  const files = {
    DATABASE_URL: 'postgres://user:secret@dev-vars.example/app',
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
      'postgres://user:secret@hyperdrive.example/app',
    MIGRATION_DATABASE_URL: 'postgres://user:secret@env-local.example/app',
  }
  const selected = (
    env: Record<string, string>,
    from: Record<string, string>,
  ) => localDatabaseUrl(env, from).hostname
  it('prefers MIGRATION_DATABASE_URL, then the Hyperdrive stand-in, then DATABASE_URL', () => {
    expect(
      selected(
        { MIGRATION_DATABASE_URL: 'postgres://user:secret@shell.example/app' },
        files,
      ),
    ).toBe('shell.example')
    expect(selected({}, files)).toBe('env-local.example')
    const { MIGRATION_DATABASE_URL: _, ...withoutOverride } = files
    expect(selected({}, withoutOverride)).toBe('hyperdrive.example')
    expect(selected({}, { DATABASE_URL: files.DATABASE_URL })).toBe(
      'dev-vars.example',
    )
  })
  it('ignores ambient connection variables and refuses production', () => {
    const ambient = {
      DATABASE_URL: 'postgres://user:secret@ambient.example/app',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        'postgres://user:secret@ambient.example/app',
    }
    expect(selected(ambient, { DATABASE_URL: files.DATABASE_URL })).toBe(
      'dev-vars.example',
    )
    expect(() => localDatabaseUrl(ambient, {})).toThrow(
      'Set local DATABASE_URL',
    )
    expect(() =>
      localDatabaseUrl(
        { APP_ENV: 'production' },
        { DATABASE_URL: files.DATABASE_URL },
      ),
    ).toThrow('APP_ENV=production')
    expect(() =>
      localDatabaseUrl(
        {
          MIGRATION_DATABASE_URL: `postgres://user:secret@${targets.productionHost}/${targets.productionDatabase}`,
        },
        {},
      ),
    ).toThrow('requires --production')
  })
})

describe('CLI error output', () => {
  it('prints the original failure and every attached cleanup failure', () => {
    const original = new Error('0001_x.sql failed.', {
      cause: new Error('division by zero'),
    })
    const error = new AggregateError(
      [
        new AggregateError(
          [
            original,
            new Error('ROLLBACK failed.', {
              cause: new Error('socket closed'),
            }),
          ],
          '0001_x.sql failed. ROLLBACK also failed.',
        ),
        new Error('Advisory unlock failed.', {
          cause: new Error('socket closed'),
        }),
      ],
      '0001_x.sql failed. ROLLBACK also failed. Advisory unlock also failed.',
    )
    expect(errorMessages(error)).toEqual([
      '0001_x.sql failed. ROLLBACK also failed. Advisory unlock also failed.',
      '0001_x.sql failed. ROLLBACK also failed.',
      '0001_x.sql failed.',
      'division by zero',
      'ROLLBACK failed.',
      'socket closed',
      'Advisory unlock failed.',
      'socket closed',
    ])
    expect(errorMessages('not an error')).toEqual([])
  })
})
