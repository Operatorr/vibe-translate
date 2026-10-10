import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null as { message: string } | null })),
}))
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    signOut: mocks.signOut,
    $store: { atoms: { session: { get: () => ({}), set: vi.fn() } } },
  }),
}))
vi.mock('../query-cache-store', () => ({
  clearPersistedCache: vi.fn(async () => undefined),
}))
import { clearResetSession, signOut } from '../auth-client'
import { clearDrafts, readDrafts, writeDrafts } from '../draft-store'

// Minimal Web Storage; node has no sessionStorage of its own.
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
}

let storage: MemoryStorage
beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('sessionStorage', storage)
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('draft store', () => {
  it('round-trips drafts per owner, dropping empty ones', () => {
    writeDrafts('a', { t1: 'Hello', t2: '' })
    writeDrafts('b', { t1: 'Other account' })
    expect(storage.getItem('vibe-translate:drafts:a')).toBe('{"t1":"Hello"}')
    expect(readDrafts('a')).toEqual({ t1: 'Hello' })
    expect(readDrafts('b')).toEqual({ t1: 'Other account' })
    expect(readDrafts('c')).toEqual({})
  })

  it('removes the key once every draft is empty', () => {
    writeDrafts('a', { t1: 'Hello' })
    writeDrafts('a', { t1: '' })
    expect(storage.getItem('vibe-translate:drafts:a')).toBeNull()
  })

  it('ignores malformed stored values', () => {
    storage.setItem('vibe-translate:drafts:a', '{not json')
    expect(readDrafts('a')).toEqual({})
    storage.setItem('vibe-translate:drafts:a', '["x"]')
    expect(readDrafts('a')).toEqual({})
    storage.setItem('vibe-translate:drafts:a', '{"t1":5,"t2":"ok"}')
    expect(readDrafts('a')).toEqual({ t2: 'ok' })
  })

  it('clears every owner’s drafts and nothing else', () => {
    writeDrafts('a', { t1: 'A' })
    writeDrafts('b', { t1: 'B' })
    storage.setItem('unrelated', 'keep')
    clearDrafts()
    expect(storage.length).toBe(1)
    expect(storage.getItem('unrelated')).toBe('keep')
  })

  it('fails soft when storage is unavailable or full', () => {
    const throwing = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    vi.stubGlobal('sessionStorage', {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
      key: throwing,
      get length(): number {
        return throwing()
      },
    })
    expect(() => writeDrafts('a', { t1: 'Hello' })).not.toThrow()
    expect(readDrafts('a')).toEqual({})
    expect(() => clearDrafts()).not.toThrow()
    vi.stubGlobal('sessionStorage', undefined)
    expect(readDrafts('a')).toEqual({})
    expect(() => writeDrafts('a', { t1: 'Hello' })).not.toThrow()
  })
})

describe('session cleanup clears drafts', () => {
  it('sign-out removes drafts before navigating home', async () => {
    const assign = vi.fn(() => {
      expect(readDrafts('a')).toEqual({})
    })
    vi.stubGlobal('window', { location: { assign } })
    writeDrafts('a', { t1: 'Unsent' })
    await signOut()
    expect(assign).toHaveBeenCalledWith('/')
    expect(storage.getItem('vibe-translate:drafts:a')).toBeNull()
  })

  it('a failed sign-out keeps the drafts of the still signed-in user', async () => {
    vi.stubGlobal('window', { location: { assign: vi.fn() } })
    mocks.signOut.mockResolvedValueOnce({ error: { message: 'Offline' } })
    writeDrafts('a', { t1: 'Unsent' })
    await expect(signOut()).rejects.toThrow('Offline')
    expect(readDrafts('a')).toEqual({ t1: 'Unsent' })
  })

  it('a password reset removes drafts', async () => {
    writeDrafts('a', { t1: 'Unsent' })
    await clearResetSession()
    expect(readDrafts('a')).toEqual({})
  })
})
