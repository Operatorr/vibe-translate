import type { Segment, Thread } from '@/lib/types'

// Pure cache updaters for the TanStack Query lists in app/hooks/use-app-data.ts.
// Kept free of React so they can be unit-tested directly.

// Append a freshly created Segment. The server de-dupes identical in-thread
// requests and returns the existing row, so `appended` is false when the id is
// already present — callers must not bump counts in that case.
export function appendSegment(
  list: Segment[] | undefined,
  created: Segment,
): { list: Segment[] | undefined; appended: boolean | null } {
  // Unloaded list: don't fabricate a partial one (it would be persisted and
  // hide the real history). `null` = unknown whether this was a new row.
  if (!list) return { list, appended: null }
  if (list.some((s) => s.id === created.id)) return { list, appended: false }
  return { list: [...list, created], appended: true }
}

// Bump a Thread's segment count/recency and keep the list ordered like the
// API (`updated_at desc`).
export function touchThread(
  list: Thread[] | undefined,
  threadId: string,
  updatedAt: string,
  countDelta: number,
): Thread[] | undefined {
  if (!list) return list
  return list
    .map((t) =>
      t.id === threadId
        ? { ...t, segmentCount: t.segmentCount + countDelta, updatedAt }
        : t,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

// Apply a Thread PATCH optimistically. Archiving removes the row from the
// (non-archived) list.
export function patchThread(
  list: Thread[] | undefined,
  id: string,
  patch: { title?: string; starred?: boolean; archived?: boolean },
): Thread[] {
  const { archived, ...fields } = patch
  return (list ?? [])
    .filter((t) => !(t.id === id && archived === true))
    .map((t) => (t.id === id ? { ...t, ...fields } : t))
}

// Reconcile the server's Thread row: archived rows leave the list.
export function applyServerThread(
  list: Thread[] | undefined,
  updated: Thread,
): Thread[] {
  if (updated.archivedAt != null)
    return (list ?? []).filter((t) => t.id !== updated.id)
  return (list ?? []).map((t) => (t.id === updated.id ? updated : t))
}
