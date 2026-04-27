import type { Client } from 'pg'

export async function logActivity(
  db: Client,
  userId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `insert into activity_log (user_id, action, metadata)
     values ($1, $2, $3)`,
    [userId, action, JSON.stringify(metadata)],
  )
}
