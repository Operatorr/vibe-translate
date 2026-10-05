import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clear: vi.fn(async (): Promise<void> => undefined),
  signOut: vi.fn(async () => ({ error: null as { message: string } | null })),
  session: {
    get: vi.fn(() => ({
      data: { user: { id: 'a' } },
      error: null,
      isPending: false,
    })),
    set: vi.fn(),
  },
}))
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    signOut: mocks.signOut,
    $store: { atoms: { session: mocks.session } },
  }),
}))
vi.mock('../query-cache-store', () => ({ clearPersistedCache: mocks.clear }))
import { clearResetSession, signOut } from '../auth-client'

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser session cleanup', () => {
  it('pauses and clears the cache before signing out and navigating', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    let release!: () => void
    mocks.clear.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pending = signOut()
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(mocks.signOut).not.toHaveBeenCalled()
    release()
    await pending
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('clears the client session after reset without navigating away from the success message', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    await clearResetSession()
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(mocks.session.set).toHaveBeenCalledWith({
      data: null,
      error: null,
      isPending: false,
    })
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })
})
