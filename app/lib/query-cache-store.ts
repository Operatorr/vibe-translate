import type { QueryClient } from '@tanstack/react-query'
import { del, get, set } from 'idb-keyval'

import { queryClient } from '@/lib/query-client'

const CACHE_KEY = 'vibe-translate:query-cache'
const OWNER_KEY = `${CACHE_KEY}:owner`
const PERSISTED_KEYS = new Set([
  'characters',
  'threads',
  'segments',
  'activity',
])
const keyFor = (userId: string) => `${CACHE_KEY}:${userId}`

type Entry = {
  queryKey: readonly unknown[]
  data: unknown
  dataUpdatedAt: number
}
type StoredCache = { userId: string; entries: Entry[] }

// Serializes storage operations, so a write already in flight finishes before
// deletion. Generation checks also cancel late hydration and queued writes.
export class QueryCachePersistence {
  private generation = 0
  private userId: string | null = null
  private unsubscribe?: () => void
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private client: QueryClient) {}

  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.pending.then(task)
    this.pending = result.catch((error) =>
      console.error('query cache storage failed', error),
    )
    return result
  }

  stop() {
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  // undefined means a settled session error: use only the last confirmed owner.
  // null means confirmed signed out: remove their offline data as well.
  activate(userId: string | null | undefined): Promise<void> {
    const previousUserId = this.userId
    this.stop()
    const generation = this.generation
    this.userId = null
    this.client.clear()
    return this.enqueue(async () => {
      const lastOwner = await get<string>(OWNER_KEY)
      if (generation !== this.generation) return
      await del(CACHE_KEY) // discard the legacy, unscoped cache
      if (userId === null) {
        if (previousUserId || lastOwner)
          await del(keyFor(previousUserId || lastOwner!))
        await del(OWNER_KEY)
        return
      }
      const owner = userId ?? lastOwner
      if (!owner) return
      if (lastOwner && lastOwner !== owner) await del(keyFor(lastOwner))
      const stored = await get<StoredCache>(keyFor(owner))
      if (generation !== this.generation) return
      if (stored?.userId === owner) {
        for (const entry of stored.entries) {
          if (PERSISTED_KEYS.has(String(entry.queryKey[0]))) {
            this.client.setQueryData(entry.queryKey, entry.data, {
              updatedAt: entry.dataUpdatedAt,
            })
          }
        }
      }
      await set(OWNER_KEY, owner)
      if (generation !== this.generation) return
      this.userId = owner
      this.unsubscribe = this.client.getQueryCache().subscribe(() => {
        const entries: Entry[] = this.client
          .getQueryCache()
          .getAll()
          .filter(
            (query) =>
              PERSISTED_KEYS.has(String(query.queryKey[0])) &&
              query.state.data !== undefined,
          )
          .map((query) => ({
            queryKey: query.queryKey,
            data: query.state.data,
            dataUpdatedAt: query.state.dataUpdatedAt,
          }))
        void this.enqueue(async () => {
          if (generation === this.generation)
            await set(keyFor(owner), {
              userId: owner,
              entries,
            } satisfies StoredCache)
        }).catch(() => undefined)
      })
    })
  }

  clear(): Promise<void> {
    // Stop persistence synchronously, before sign-out or cancellation can emit
    // cache notifications. clear() cancels active queries and removes all data.
    return this.activate(null)
  }
}

export const queryCachePersistence = new QueryCachePersistence(queryClient)
export const clearPersistedCache = () => queryCachePersistence.clear()
