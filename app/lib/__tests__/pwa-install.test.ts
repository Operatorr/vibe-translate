import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))
import { startInstallPrompt } from '../pwa-install-controller'

const DISMISS_KEY = 'vibe-translate:install-dismissed-at'
let browser: EventTarget & {
  matchMedia: ReturnType<typeof vi.fn>
  isSecureContext: boolean
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}
let mobile: boolean
let standalone: boolean
let storage: Map<string, string>
let cleanup: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mobile = true
  standalone = false
  storage = new Map()
  browser = Object.assign(new EventTarget(), {
    isSecureContext: true,
    matchMedia: vi.fn((query: string) => ({
      matches: query.includes('display-mode') ? standalone : mobile,
    })),
    setTimeout,
    clearTimeout,
  })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('navigator', { userAgent: 'Android', maxTouchPoints: 1 })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  })
}
const options = () => mocks.toast.mock.calls[0][1]

describe('mobile installation', () => {
  it('offers a persistent native install action, invoked only by a tap', async () => {
    cleanup = startInstallPrompt()
    const event = installEvent()
    browser.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(event.prompt).not.toHaveBeenCalled()
    expect(options()).toMatchObject({
      position: 'bottom-center',
      duration: Infinity,
    })
    options().action.onClick()
    await vi.runAllTimersAsync()
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(mocks.toast.dismiss).toHaveBeenCalledWith('pwa-install')
    expect(storage.size).toBe(0)
    browser.dispatchEvent(installEvent())
    expect(mocks.toast).toHaveBeenCalledOnce()
  })

  it('leaves desktop native installation untouched', () => {
    mobile = false
    cleanup = startInstallPrompt()
    const event = installEvent()
    browser.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it.each(['Not now', 'close', 'native dismissal'])(
    'remembers %s for 14 days',
    async (action) => {
      cleanup = startInstallPrompt()
      browser.dispatchEvent(installEvent('dismissed'))
      if (action === 'Not now') options().cancel.onClick()
      else if (action === 'close') options().onDismiss()
      else {
        options().action.onClick()
        await vi.runAllTimersAsync()
      }
      expect(storage.has(DISMISS_KEY)).toBe(true)
      cleanup()
      mocks.toast.mockClear()
      cleanup = startInstallPrompt()
      const event = installEvent()
      browser.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(mocks.toast).not.toHaveBeenCalled()
      cleanup()
      vi.advanceTimersByTime(14 * 24 * 60 * 60 * 1000)
      cleanup = startInstallPrompt()
      browser.dispatchEvent(installEvent())
      expect(mocks.toast).toHaveBeenCalledOnce()
    },
  )

  it.each(['iPhone', 'Macintosh'])(
    'shows manual instructions on %s',
    async (userAgent) => {
      vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 5 })
      cleanup = startInstallPrompt()
      expect(mocks.toast).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2500)
      expect(options().description).toContain('Add to Home Screen')
      expect(options().action.label).toBe('Got it')
    },
  )

  it('suppresses hints in installed standalone apps', async () => {
    standalone = true
    vi.stubGlobal('navigator', { userAgent: 'iPhone' })
    cleanup = startInstallPrompt()
    const event = installEvent()
    browser.dispatchEvent(event)
    await vi.runAllTimersAsync()
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('removes a shown toast and pending iOS hints when installed elsewhere', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone' })
    cleanup = startInstallPrompt()
    browser.dispatchEvent(installEvent())
    browser.dispatchEvent(new Event('appinstalled'))
    await vi.runAllTimersAsync()
    expect(mocks.toast).toHaveBeenCalledOnce()
    expect(mocks.toast.dismiss).toHaveBeenCalledWith('pwa-install')
  })

  it('handles native prompt failure without an unhandled rejection', async () => {
    cleanup = startInstallPrompt()
    const event = installEvent()
    event.prompt.mockRejectedValueOnce(new Error('Unavailable'))
    browser.dispatchEvent(event)
    options().action.onClick()
    await vi.runAllTimersAsync()
    expect(mocks.toast.error).toHaveBeenCalledOnce()
  })

  it('works with blocked storage and cleans up events/timers on unmount', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Blocked')
      },
    })
    cleanup = startInstallPrompt()
    browser.dispatchEvent(installEvent())
    expect(() => options().cancel.onClick()).not.toThrow()
    cleanup()
    mocks.toast.mockClear()
    browser.dispatchEvent(installEvent())
    await vi.runAllTimersAsync()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
