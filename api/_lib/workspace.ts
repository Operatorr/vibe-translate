import type { Client } from 'pg'

import type { Persona, SegmentToken, VibeStop } from './schemas'

// Character → Thread → Segment row shapes (snake_case → API camelCase), the
// bounded Segment page, and the bootstrap/workspace snapshot reads. Every
// route that builds a Segment page goes through `toSegmentPage`, so the page
// size, lookahead and cursor rules live in one place. See docs/API.md.

export const CHARACTER_COLUMNS = `id, user_id, name, initials, color, source_language, target_language,
  default_vibe, temperature, persona, instructions, sort_order, archived_at, created_at, updated_at`

export type CharacterDbRow = {
  id: string
  user_id: string
  name: string
  initials: string | null
  color: string | null
  source_language: string
  target_language: string
  default_vibe: VibeStop
  temperature: string | number
  persona: Persona
  instructions: string | null
  sort_order: number
  archived_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

export function mapCharacter(r: CharacterDbRow) {
  return {
    id: r.id,
    name: r.name,
    initials: r.initials ?? undefined,
    color: r.color ?? undefined,
    sourceLanguage: r.source_language,
    targetLanguage: r.target_language,
    defaultVibe: r.default_vibe,
    temperature: Number(r.temperature),
    persona: r.persona,
    instructions: r.instructions ?? undefined,
    sortOrder: r.sort_order,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

// `segment_count` is a correlated subquery so the sidebar can show
// "N translations" without a second round-trip. Every query using this list
// selects `from threads` unaliased, so the bare `threads.id` reference holds.
export const THREAD_COLUMNS = `id, character_id, user_id, title, starred, archived_at, created_at, updated_at,
  (select count(*)::int from segments s where s.thread_id = threads.id) as segment_count`

export type ThreadDbRow = {
  id: string
  character_id: string
  user_id: string
  title: string
  starred: boolean
  archived_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  segment_count: number
}

export function mapThread(r: ThreadDbRow) {
  return {
    id: r.id,
    characterId: r.character_id,
    title: r.title,
    starred: r.starred,
    segmentCount: Number(r.segment_count ?? 0),
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

export const SEGMENT_COLUMNS = `id, thread_id, source_text, target_text, vibe, token_alignment,
  token_usage, created_at, updated_at`

export type SegmentDbRow = {
  id: string
  thread_id: string
  source_text: string
  target_text: string
  vibe: VibeStop | null
  token_alignment: SegmentToken[]
  token_usage: Record<string, unknown>
  created_at: string | Date
  updated_at: string | Date
}

export function mapSegment(r: SegmentDbRow) {
  return {
    id: r.id,
    threadId: r.thread_id,
    sourceText: r.source_text,
    targetText: r.target_text,
    vibe: r.vibe,
    tokenAlignment: r.token_alignment,
    tokenUsage: r.token_usage,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

// ---- Segment pages --------------------------------------------------------

export const SEGMENT_PAGE_SIZE = 50
// One extra row proves older history exists without a count query.
const SEGMENT_PAGE_LOOKAHEAD = SEGMENT_PAGE_SIZE + 1

// JavaScript dates stop at milliseconds; the cursor keeps Postgres
// microseconds so same-millisecond rows are neither skipped nor repeated.
const SEGMENT_PAGE_COLUMNS = `${SEGMENT_COLUMNS},
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at`
const SEGMENT_PAGE_ORDER = `order by created_at desc, id desc limit ${SEGMENT_PAGE_LOOKAHEAD}`

type SegmentPageDbRow = SegmentDbRow & { cursor_created_at: string }

export type SegmentCursor = { createdAt: string; id: string }

// Rows arrive newest first (at most the lookahead). The page is returned
// chronologically; its oldest row becomes the cursor only when the lookahead
// row exists, so an exactly-full final page reports no further history.
export function toSegmentPage(rows: SegmentPageDbRow[]) {
  const page = rows.slice(0, SEGMENT_PAGE_SIZE)
  const oldest = page.at(-1)
  const nextCursor: SegmentCursor | null =
    rows.length > SEGMENT_PAGE_SIZE && oldest
      ? { createdAt: oldest.cursor_created_at, id: oldest.id }
      : null
  return { segments: page.reverse().map(mapSegment), nextCursor }
}

// The strict `(created_at, id)` comparison uses the UUID as a tie-breaker for
// rows created in the same transaction.
export async function loadSegmentPage(
  db: Client,
  userId: string,
  threadId: string,
  before?: SegmentCursor,
) {
  const res = await db.query<SegmentPageDbRow>(
    `select ${SEGMENT_PAGE_COLUMNS}
       from segments where user_id = $1 and thread_id = $2
       ${before ? 'and (created_at, id) < ($3::timestamptz, $4::uuid)' : ''}
       ${SEGMENT_PAGE_ORDER}`,
    before
      ? [userId, threadId, before.createdAt, before.id]
      : [userId, threadId],
  )
  return toSegmentPage(res.rows)
}

// ---- Workspace snapshots --------------------------------------------------

// Threads and the head Segment page of whichever Character the preceding
// `chosen_character` CTE selects; $1 is the owner throughout. Threads use the
// GET /api/threads order, so the chosen Thread is the newest.
const WORKSPACE_CTES = `thread_list as (
    select ${THREAD_COLUMNS} from threads
    where user_id = $1 and archived_at is null
      and character_id = (select id from chosen_character)
  ), chosen_thread as (
    select id from thread_list order by updated_at desc, id desc limit 1
  ), segment_page as (
    select ${SEGMENT_PAGE_COLUMNS}
    from segments where user_id = $1 and thread_id = (select id from chosen_thread)
    ${SEGMENT_PAGE_ORDER}
  )`

const WORKSPACE_FIELDS = `coalesce((select json_agg(t order by updated_at desc, id desc) from thread_list t), '[]') as threads,
  coalesce((select json_agg(s order by created_at desc, id desc) from segment_page s), '[]') as segments,
  (select id from chosen_character) as character_id,
  (select id from chosen_thread) as thread_id`

type WorkspaceDbRow = {
  threads: ThreadDbRow[]
  segments: SegmentPageDbRow[]
  character_id: string | null
  thread_id: string | null
}

function mapWorkspace(row: WorkspaceDbRow) {
  return {
    characterId: row.character_id,
    threads: row.threads.map(mapThread),
    threadId: row.thread_id,
    segmentPage: toSegmentPage(row.segments),
  }
}

// One Character's Threads and head page, for a first visit whose roster and
// account are already cached. No fallback: a missing, archived or foreign id
// yields an empty workspace with `characterId: null`.
export async function loadWorkspace(
  db: Client,
  userId: string,
  characterId: string,
) {
  const res = await db.query<WorkspaceDbRow>(
    `with chosen_character as (
       select id from characters
       where id = $2::uuid and user_id = $1 and archived_at is null
     ), ${WORKSPACE_CTES}
     select ${WORKSPACE_FIELDS}`,
    [userId, characterId],
  )
  return mapWorkspace(res.rows[0])
}

// The active roster plus one Character's workspace in one database snapshot.
// A missing, archived or foreign preference falls back to the first active
// Character in roster order.
export async function loadBootstrap(
  db: Client,
  userId: string,
  preferredCharacterId: string | null,
) {
  const res = await db.query<WorkspaceDbRow & { characters: CharacterDbRow[] }>(
    `with character_list as (
       select ${CHARACTER_COLUMNS} from characters
       where user_id = $1 and archived_at is null
     ), chosen_character as (
       select id from character_list
       order by (id = $2::uuid) desc nulls last, sort_order, created_at, id limit 1
     ), ${WORKSPACE_CTES}
     select coalesce((select json_agg(c order by sort_order, created_at, id) from character_list c), '[]') as characters,
       ${WORKSPACE_FIELDS}`,
    [userId, preferredCharacterId],
  )
  const row = res.rows[0]
  return { characters: row.characters.map(mapCharacter), ...mapWorkspace(row) }
}
