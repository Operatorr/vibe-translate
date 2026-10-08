import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadBootstrap, loadSegmentPage, loadWorkspace } from '../workspace'
import { fixtureId, localClients, withLocalFixtures } from './local-db'

const BASE = '2026-01-02T03:04:05.123400Z'
// The cursor text PostgreSQL produces for BASE plus `micros` microseconds.
const cursorAt = (micros: number) =>
  `2026-01-02T03:04:05.${String(123400 + micros).padStart(6, '0')}Z`

// Explicit local-only opt-in; see local-db.ts for target resolution. Exercises
// selection, owner isolation and cursor paging against real PostgreSQL order.
describe.runIf(process.env.RUN_LOCAL_DB_PERF === '1')(
  'local workspace snapshots',
  () => {
    it('selects, isolates and pages owner data deterministically', async () => {
      const [db] = localClients(1)
      const owner = fixtureId('workspace-owner')
      const other = fixtureId('workspace-other')
      const empty = fixtureId('workspace-empty')
      // Sorted so the id tie-breaks are known: Characters id asc, Threads id desc.
      const [tieFirst, tieSecond] = [randomUUID(), randomUUID()].sort()
      const [threadTieLow, threadTieHigh] = [randomUUID(), randomUUID()].sort()
      const ids = {
        archivedCharacter: randomUUID(),
        emptyCharacter: randomUUID(),
        foreignCharacter: randomUUID(),
        archivedThread: randomUUID(),
        oldThread: randomUUID(),
        secondThread: randomUUID(),
        foreignThread: randomUUID(),
      }
      await withLocalFixtures(
        [db],
        async () => {
          await db.connect()
          await db.query(
            `insert into auth_users (id, name, email, email_verified)
             select id, 'Temporary workspace test', id || '@example.invalid', true
             from unnest($1::text[]) id`,
            [[owner, other, empty]],
          )
          await db.query(
            `insert into users (auth_user_id, email)
             select id, id || '@example.invalid' from unnest($1::text[]) id`,
            [[owner, other, empty]],
          )
          // The archived and foreign Characters sort ahead of every active one
          // the owner has, so a missing filter changes the selection.
          await db.query(
            `insert into characters
               (id, user_id, name, source_language, target_language, sort_order, created_at, archived_at)
             values ($1, $6, 'Archived', 'en-US', 'ja-JP', -1, $8, $8),
                    ($2, $6, 'Tie first', 'en-US', 'ja-JP', 0, $8, null),
                    ($3, $6, 'Tie second', 'en-US', 'ja-JP', 0, $8, null),
                    ($4, $6, 'Empty', 'en-US', 'ja-JP', 1, $8, null),
                    ($5, $7, 'Foreign', 'en-US', 'ja-JP', -5, $8, null)`,
            [
              ids.archivedCharacter,
              tieFirst,
              tieSecond,
              ids.emptyCharacter,
              ids.foreignCharacter,
              owner,
              other,
              BASE,
            ],
          )
          await db.query(
            `insert into threads (id, character_id, user_id, title, updated_at, archived_at)
             values ($1, $6, $8, 'Archived', $10::timestamptz + interval '10 seconds', $10),
                    ($2, $6, $8, 'Tie low', $10::timestamptz + interval '5 seconds', null),
                    ($3, $6, $8, 'Tie high', $10::timestamptz + interval '5 seconds', null),
                    ($4, $6, $8, 'Old', $10::timestamptz + interval '1 second', null),
                    ($5, $7, $8, 'Second', $10, null),
                    ($11, $12, $9, 'Foreign', $10::timestamptz + interval '20 seconds', null)`,
            [
              ids.archivedThread,
              threadTieLow,
              threadTieHigh,
              ids.oldThread,
              ids.secondThread,
              tieFirst,
              tieSecond,
              owner,
              other,
              BASE,
              ids.foreignThread,
              ids.foreignCharacter,
            ],
          )
          // `g / divisor` pairs rows onto one microsecond when divisor is 2,
          // so the UUID tie-breaker decides their order.
          const seed = (
            threadId: string,
            userId: string,
            count: number,
            divisor: number,
          ) =>
            db.query(
              `insert into segments (thread_id, user_id, source_text, target_text, created_at)
               select $1::uuid, $2, 'seg-' || g, 'tgt-' || g,
                      $3::timestamptz + (g / $4::int) * interval '1 microsecond'
               from generate_series(1, $5::int) g`,
              [threadId, userId, BASE, divisor, count],
            )
          await seed(threadTieHigh, owner, 51, 2)
          await seed(ids.secondThread, owner, 50, 1)
          await seed(ids.archivedThread, owner, 2, 1)
          await seed(ids.foreignThread, other, 3, 1)

          const head = await db.query<{ id: string; source_text: string }>(
            'select id, source_text from segments where thread_id = $1',
            [threadTieHigh],
          )
          const chronological = head.rows
            .map((row) => ({
              id: row.id,
              micros: Math.floor(Number(row.source_text.slice(4)) / 2),
            }))
            .sort((a, b) => a.micros - b.micros || (a.id < b.id ? -1 : 1))
          const emptyWorkspace = {
            threads: [],
            threadId: null,
            segmentPage: { segments: [], nextCursor: null },
          }

          // Default selection: archived/foreign Characters skipped, Character
          // ties by id asc, Thread ties by id desc, archived Thread skipped.
          const initial = await loadBootstrap(db, owner, null)
          expect(initial.characters.map((c) => c.id)).toEqual([
            tieFirst,
            tieSecond,
            ids.emptyCharacter,
          ])
          expect(initial.characterId).toBe(tieFirst)
          expect(initial.threads.map((t) => t.id)).toEqual([
            threadTieHigh,
            threadTieLow,
            ids.oldThread,
          ])
          expect(initial.threadId).toBe(threadTieHigh)
          expect(initial.segmentPage.segments.map((s) => s.id)).toEqual(
            chronological.slice(1).map((s) => s.id),
          )
          expect(initial.segmentPage.nextCursor).toEqual({
            createdAt: cursorAt(chronological[1].micros),
            id: chronological[1].id,
          })
          const older = await loadSegmentPage(
            db,
            owner,
            threadTieHigh,
            initial.segmentPage.nextCursor ?? undefined,
          )
          expect(older.segments.map((s) => s.id)).toEqual([chronological[0].id])
          expect(older.nextCursor).toBeNull()

          // Archived, foreign and unknown preferences fall back unchanged.
          for (const preferred of [
            ids.archivedCharacter,
            ids.foreignCharacter,
            randomUUID(),
          ])
            expect(await loadBootstrap(db, owner, preferred)).toEqual(initial)

          // A valid preference wins; an exactly-full head page is exhausted.
          const second = await loadBootstrap(db, owner, tieSecond)
          expect(second.characterId).toBe(tieSecond)
          expect(second.threads.map((t) => t.id)).toEqual([ids.secondThread])
          expect(second.segmentPage.segments.map((s) => s.sourceText)).toEqual(
            Array.from({ length: 50 }, (_, i) => `seg-${i + 1}`),
          )
          expect(second.segmentPage.nextCursor).toBeNull()
          expect(await loadWorkspace(db, owner, tieSecond)).toEqual({
            characterId: second.characterId,
            threads: second.threads,
            threadId: second.threadId,
            segmentPage: second.segmentPage,
          })
          expect(await loadWorkspace(db, owner, tieFirst)).toEqual({
            characterId: initial.characterId,
            threads: initial.threads,
            threadId: initial.threadId,
            segmentPage: initial.segmentPage,
          })

          // A Character with no Threads is selected with an empty workspace.
          expect(await loadWorkspace(db, owner, ids.emptyCharacter)).toEqual({
            characterId: ids.emptyCharacter,
            ...emptyWorkspace,
          })
          expect(
            await loadBootstrap(db, owner, ids.emptyCharacter),
          ).toMatchObject({
            characterId: ids.emptyCharacter,
            ...emptyWorkspace,
          })

          // The workspace never falls back: not owned or not active is null.
          for (const characterId of [
            ids.archivedCharacter,
            ids.foreignCharacter,
            randomUUID(),
          ])
            expect(await loadWorkspace(db, owner, characterId)).toEqual({
              characterId: null,
              ...emptyWorkspace,
            })

          // An account without Characters, even when preferring another's.
          for (const preferred of [null, tieFirst])
            expect(await loadBootstrap(db, empty, preferred)).toEqual({
              characters: [],
              characterId: null,
              ...emptyWorkspace,
            })

          // The other account sees only its own rows.
          const foreign = await loadBootstrap(db, other, tieFirst)
          expect(foreign.characters.map((c) => c.id)).toEqual([
            ids.foreignCharacter,
          ])
          expect(foreign.threadId).toBe(ids.foreignThread)
          expect(foreign.segmentPage.segments).toHaveLength(3)
          expect(await loadSegmentPage(db, owner, ids.foreignThread)).toEqual({
            segments: [],
            nextCursor: null,
          })
        },
        () =>
          db.query('delete from auth_users where id = any($1::text[])', [
            [owner, other, empty],
          ]),
      )
    }, 20_000)
  },
)
