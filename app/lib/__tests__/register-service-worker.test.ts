import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerServiceWorker } from '../register-service-worker'

let browser: EventTarget
const register = vi.fn(async () => ({}))
const getRegistrations = vi.fn()
const deleteCache = vi.fn(async () => true)
const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  browser = new EventTarget()
  Object.assign(browser, { caches: {} })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('location', { origin: 'https://vibe.example' })
  vi.stubGlobal('document', { readyState: 'complete' })
  vi.stubGlobal('navigator', { serviceWorker: { register, getRegistrations } })
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => ['vibe-translate-static-old', 'another-app-cache']),
    delete: deleteCache,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each(['complete', 'loading'])(
  'registers with a %s document and bypasses the HTTP cache',
  async (readyState) => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('document', { readyState })
    registerServiceWorker()
    if (readyState === 'loading') {
      expect(register).not.toHaveBeenCalled()
      browser.dispatchEvent(new Event('load'))
      browser.dispatchEvent(new Event('load'))
    }
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', {
      updateViaCache: 'none',
    })
  },
)

it.each(['active', 'waiting', 'installing'])(
  'cleans up only owned %s workers and caches in development',
  async (state) => {
    vi.stubEnv('DEV', true)
    const owned = vi.fn(async () => true)
    const unrelated = vi.fn(async () => true)
    getRegistrations.mockResolvedValue([
      {
        [state]: { scriptURL: 'https://vibe.example/sw.js' },
        unregister: owned,
      },
      {
        waiting: { scriptURL: 'https://vibe.example/other-sw.js' },
        unregister: unrelated,
      },
    ])
    registerServiceWorker()
    await vi.waitFor(() =>
      expect(deleteCache).toHaveBeenCalledExactlyOnceWith(
        'vibe-translate-static-old',
      ),
    )
    expect(owned).toHaveBeenCalledOnce()
    expect(unrelated).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  },
)

it.each(['registration', 'cleanup'])(
  'reports %s rejection',
  async (operation) => {
    const error = new Error('Unavailable')
    vi.stubEnv('DEV', operation === 'cleanup')
    if (operation === 'cleanup') getRegistrations.mockRejectedValueOnce(error)
    else register.mockRejectedValueOnce(error)
    registerServiceWorker()
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        operation === 'cleanup'
          ? 'Service worker cleanup failed'
          : 'Service worker registration failed',
        error,
      ),
    )
  },
)
