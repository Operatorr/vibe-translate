import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapOptions } from '../app-bootstrap'
import { keys } from '../query-keys'

const snapshot = {
  me: { displayName: 'a' },
  characters: ['a'],
  threads: [],
  characterId: null,
  threadId: null,
  segmentPage: { segments: [], nextCursor: null },
}
afterEach(() => vi.unstubAllGlobals())
describe('bootstrap ownership and races', () => {
  it('does not seed a cancelled account response even when fetch ignores abort', async () => {
    let finish!: (r: Response) => void
    const fetch = vi.fn(
      () =>
        new Promise<Response>((r) => {
          finish = r
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const client = new QueryClient()
    const pending = client
      .fetchQuery(bootstrapOptions(client, null))
      .catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    client.clear()
    client.setQueryData(keys.characters, ['b'])
    finish(Response.json(snapshot))
    await pending
    await new Promise((r) => setTimeout(r, 0))
    expect(client.getQueryData(keys.characters)).toEqual(['b'])
    expect(client.getQueryData(keys.me)).toBeUndefined()
    client.clear()
  })
  it('does not replace domain data updated while the snapshot is in flight', async () => {
    let finish!: (r: Response) => void
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((r) => {
          finish = r
        }),
    )
    const client = new QueryClient()
    const pending = client.fetchQuery(bootstrapOptions(client, null))
    await Promise.resolve()
    await Promise.resolve()
    client.setQueryData(keys.characters, ['newer mutation'])
    finish(Response.json(snapshot))
    await pending
    expect(client.getQueryData(keys.characters)).toEqual(['newer mutation'])
    client.clear()
  })
})
