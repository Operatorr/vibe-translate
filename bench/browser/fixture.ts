// Disposable Local fixture for the controlled browser comparison in
// docs/PERFORMANCE.md: one verified email/password account, three Characters,
// twelve Threads and 6,090 Segments (three 2,000-row Threads plus nine
// ten-row Threads). The account is written directly, so no verification email
// is sent, and cleanup deletes it with every cascaded row.
//
//   PERF_EMAIL=perf-1@example.invalid PERF_PASSWORD=… node bench/browser/fixture.ts seed
//   PERF_EMAIL=perf-1@example.invalid node bench/browser/fixture.ts cleanup
import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { localDatabaseUrl, migrationClient } from '../../scripts/db-migrate.ts'

const LONG_ROWS = 2_000
const SHORT_ROWS = 10

const [command] = process.argv.slice(2)
const email = process.env.PERF_EMAIL ?? ''
// The reserved TLD keeps cleanup from ever matching a real account.
if (!email.endsWith('@example.invalid'))
  throw new Error('PERF_EMAIL must be a disposable …@example.invalid address.')
if (command !== 'seed' && command !== 'cleanup')
  throw new Error('Usage: node bench/browser/fixture.ts seed|cleanup')

const db = migrationClient(localDatabaseUrl(), {
  connectionTimeoutMillis: 15_000,
})
await db.connect()
try {
  if (command === 'cleanup') {
    const removed = await db.query('delete from auth_users where email = $1', [
      email,
    ])
    console.log(`Removed ${removed.rowCount ?? 0} fixture account(s).`)
  } else {
    const password = process.env.PERF_PASSWORD ?? ''
    if (password.length < 8)
      throw new Error('PERF_PASSWORD must have at least 8 characters.')
    await seed(email, password)
    console.log(`Seeded ${email}.`)
  }
} finally {
  await db.end()
}

async function seed(address: string, password: string) {
  const userId = randomUUID()
  await db.query('begin')
  try {
    await db.query(
      `insert into auth_users (id, name, email, email_verified)
       values ($1, 'Performance fixture', $2, true)`,
      [userId, address],
    )
    await db.query(
      `insert into auth_accounts (id, account_id, provider_id, user_id, password, updated_at)
       values ($1, $2, 'credential', $2, $3, now())`,
      [randomUUID(), userId, await hashPassword(password)],
    )
    // No signup grant, so balance = sum(ledger) = 0 still holds.
    await db.query(
      `insert into users (auth_user_id, email, display_name, onboarding_complete)
       values ($1, $2, 'Perf', true)`,
      [userId, address],
    )
    for (let c = 1; c <= 3; c++) {
      const character = await db.query<{ id: string }>(
        `insert into characters (user_id, name, initials, source_language, target_language, sort_order)
         values ($1, $2, $3, 'en-US', 'ja-JP', $4) returning id`,
        [userId, `Perf Character ${c}`, `P${c}`, c - 1],
      )
      const characterId = character.rows[0].id
      // The long Thread is newest, so it opens first for each Character.
      await thread(userId, characterId, `Long thread ${c}`, 0, LONG_ROWS)
      for (let t = 1; t <= 3; t++)
        await thread(
          userId,
          characterId,
          `Short thread ${c}-${t}`,
          t,
          SHORT_ROWS,
        )
    }
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

async function thread(
  userId: string,
  characterId: string,
  title: string,
  age: number,
  rows: number,
) {
  const created = await db.query<{ id: string; updated_at: Date }>(
    `insert into threads (character_id, user_id, title, updated_at)
     values ($1, $2, $3, now() - $4 * interval '1 hour') returning id, updated_at`,
    [characterId, userId, title, age],
  )
  const { id, updated_at } = created.rows[0]
  // Row N is N seconds older than the Thread's last activity; the oldest is
  // "Example sentence <rows>".
  await db.query(
    `insert into segments (thread_id, user_id, source_text, target_text, vibe, created_at, updated_at)
     select $1, $2, 'Example sentence ' || g, 'これは例文です。' || g, 'casual',
            $3::timestamptz - g * interval '1 second',
            $3::timestamptz - g * interval '1 second'
       from generate_series(1, $4) as g`,
    [id, userId, updated_at, rows],
  )
}
