import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const origin = 'https://vibe.example'
const source = readFileSync(
  new URL('../../../public/sw.js', import.meta.url),
  'utf8',
)
  .replace('__BUILD_VERSION__', 'test-release')
  .replace(
    '/* __BUILD_ASSETS__ */ []',
    JSON.stringify(
      ['/assets/main.js', '/assets/app.css', '/assets/lazy.js'].map((url) => ({
        url,
        integrity: `sha256-${createHash('sha256')
          .update(origin + url)
          .digest('base64')}`,
      })),
    ),
  )
  .replace("/* __BUILD_SHELL__ */ ''", JSON.stringify(origin + '/'))
  .replace(
    '/* __OPTIONAL_ASSETS__ */ []',
    JSON.stringify(['/icons/icon-192.png']),
  )
const cacheName = 'vibe-translate-static-test-release'

type WorkerEvent = {
  request?: { url: string; method: string; mode: string; headers?: Headers }
  waitUntil: (promise: Promise<unknown>) => void
  respondWith: (promise: Promise<unknown>) => void
}

function worker(failingUrl?: string) {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const entries = new Map<string, Response>()
  const key = (input: string | { url: string }) =>
    new URL(typeof input === 'string' ? input : input.url, origin).href
  const cachedRequests = new Map<string, Headers>()
  const fetcher = vi.fn(async (input: string | { url: string }) => {
    if (key(input).endsWith(failingUrl ?? 'no-failure'))
      throw new Error('Offline')
    return new Response(key(input))
  })
  const cache = {
    addAll: vi.fn(async (requests: Request[]) => {
      const responses = await Promise.all(requests.map(fetcher))
      for (const [i, request] of requests.entries()) {
        if (!responses[i].ok) throw new Error('HTTP failure')
        const digest = createHash('sha256')
          .update(await responses[i].clone().text())
          .digest('base64')
        if (request.integrity && request.integrity !== `sha256-${digest}`)
          throw new Error('Integrity mismatch')
      }
      requests.forEach((request, i) => {
        entries.set(key(request), responses[i])
        cachedRequests.set(key(request), request.headers)
      })
    }),
    add: vi.fn(async (url: string) => {
      const response = await fetcher(url)
      if (!response.ok) throw new Error('HTTP failure')
      entries.set(key(url), response)
    }),
    match: vi.fn(
      async (
        request: string | { url: string; headers?: Headers },
        options?: { ignoreVary?: boolean },
      ) => {
        const response = entries.get(key(request))
        if (!response) return undefined
        if (!options?.ignoreVary) {
          const headers =
            typeof request === 'string'
              ? new Headers()
              : (request.headers ?? new Headers())
          const stored = cachedRequests.get(key(request)) ?? new Headers()
          const vary = response.headers.get('vary')
          if (
            vary &&
            vary
              .split(',')
              .some(
                (name) =>
                  name.trim() === '*' ||
                  stored.get(name.trim()) !== headers.get(name.trim()),
              )
          )
            return undefined
        }
        return response.clone()
      },
    ),
    put: vi.fn(
      async (request: string | { url: string }, response: Response) => {
        entries.set(key(request), response)
      },
    ),
  }
  const cacheStorage = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      cacheName,
      'vibe-translate-static-v3',
      'another-app-cache',
    ]),
    delete: vi.fn(async () => true),
  }
  const claim = vi.fn(async () => {})
  const skipWaiting = vi.fn()
  runInNewContext(source, {
    self: {
      location: { origin },
      clients: { claim },
      skipWaiting,
      addEventListener: (
        name: string,
        listener: (event: WorkerEvent) => void,
      ) => listeners.set(name, listener),
    },
    caches: cacheStorage,
    URL,
    Response,
    Request: class extends Request {
      constructor(url: string, options: RequestInit) {
        super(new URL(url, origin), options)
      }
    },
    fetch: fetcher,
  })
  const dispatch = (
    name: string,
    path = '/',
    mode = 'cors',
    method = 'GET',
    headers = new Headers(),
  ) => {
    const pending: Promise<unknown>[] = []
    let response: Promise<unknown> | undefined
    listeners.get(name)!({
      request: { url: new URL(path, origin).href, method, mode, headers },
      waitUntil: (promise) => {
        pending.push(promise)
      },
      respondWith: (promise) => {
        response = promise
      },
    })
    return {
      get response() {
        return response
      },
      done: async () => {
        const result = await response
        await Promise.all(pending)
        return result as Response | undefined
      },
    }
  }
  return { cache, entries, cacheStorage, fetcher, claim, skipWaiting, dispatch }
}

describe('production offline worker', () => {
  it.each(['/assets/lazy.js', '/icons/icon-192.png'])(
    'handles HTTP 404 for %s according to its role',
    async (path) => {
      const w = worker()
      const original = w.fetcher.getMockImplementation()!
      w.fetcher.mockImplementation(async (input) =>
        new URL(typeof input === 'string' ? input : input.url, origin)
          .pathname === path
          ? new Response('Missing', { status: 404 })
          : original(input),
      )
      if (path.startsWith('/assets/'))
        await expect(w.dispatch('install').done()).rejects.toThrow(
          'HTTP failure',
        )
      else await expect(w.dispatch('install').done()).resolves.toBeUndefined()
    },
  )

  it('rejects deployment fallback HTML instead of activating a mismatched build', async () => {
    const w = worker()
    w.fetcher.mockResolvedValue(
      new Response('<script src="/assets/new-release.js"></script>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    await expect(w.dispatch('install').done()).rejects.toThrow(
      'Integrity mismatch',
    )
    expect(w.entries.size).toBe(0)
  })

  it('uses embedded HTML rather than fetching the mutable deployment root', async () => {
    const w = worker()
    await w.dispatch('install').done()
    expect(
      w.fetcher.mock.calls.some(
        ([request]) =>
          new URL(typeof request === 'string' ? request : request.url, origin)
            .pathname === '/',
      ),
    ).toBe(false)
    expect(await w.cache.match('/')?.then((response) => response?.text())).toBe(
      origin + '/',
    )
  })

  it('serves offline modules when Vary: Origin differs from the precache request', async () => {
    const w = worker()
    const original = w.fetcher.getMockImplementation()!
    w.fetcher.mockImplementation(async (input) => {
      const response = await original(input)
      response.headers.set('Vary', 'Origin')
      return response
    })
    await w.dispatch('install').done()
    const headers = new Headers({ Origin: origin })
    const request = { url: origin + '/assets/main.js', headers }
    expect(await w.cache.match(request)).toBeUndefined()
    w.fetcher.mockRejectedValue(new Error('Offline'))
    expect(
      await (
        await w
          .dispatch('fetch', '/assets/main.js', 'cors', 'GET', headers)
          .done()
      )?.text(),
    ).toBe(origin + '/assets/main.js')
  })

  it('serves share navigations network-first without caching shared responses', async () => {
    const w = worker()
    await w.dispatch('install').done()
    w.cache.put.mockClear()
    w.fetcher.mockResolvedValue(new Response('online share shell'))
    expect(
      await (
        await w.dispatch('fetch', '/share/token', 'navigate').done()
      )?.text(),
    ).toBe('online share shell')
    expect(w.cache.put).not.toHaveBeenCalled()
    w.fetcher.mockRejectedValue(new Error('Offline'))
    expect(
      await (
        await w.dispatch('fetch', '/share/token', 'navigate').done()
      )?.text(),
    ).toBe(origin + '/')
  })

  it('precaches the entire build on the first visit, including unvisited chunks', async () => {
    const w = worker()
    await w.dispatch('install').done()
    expect(w.entries.has(`${origin}/assets/lazy.js`)).toBe(true)
    expect(
      w.cache.addAll.mock.calls[0][0].every(
        (request) => request.cache === 'reload',
      ),
    ).toBe(true)
    expect(w.skipWaiting).not.toHaveBeenCalled()
    w.fetcher.mockRejectedValue(new Error('Offline'))
    const shell = await w.dispatch('fetch', '/app', 'navigate').done()
    expect(await shell?.text()).toBe(`${origin}/`)
    const chunk = await w.dispatch('fetch', '/assets/lazy.js').done()
    expect(await chunk?.text()).toBe(`${origin}/assets/lazy.js`)
    expect(w.cache.match).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: `${origin}/assets/lazy.js` }),
      { ignoreVary: true },
    )
  })

  it('rejects installation when an essential chunk fails, but tolerates missing icons', async () => {
    await expect(
      worker('/assets/lazy.js').dispatch('install').done(),
    ).rejects.toThrow('Offline')
    await expect(
      worker('/icons/icon-192.png').dispatch('install').done(),
    ).resolves.toBeUndefined()
  })

  it('does not replace the old offline shell with HTML from a newer deploy', async () => {
    const w = worker()
    await w.dispatch('install').done()
    w.fetcher.mockResolvedValue(new Response('new release'))
    await w.dispatch('fetch', '/app', 'navigate').done()
    expect(w.cache.put).toHaveBeenCalledOnce()
    expect(await w.cache.match('/')?.then((response) => response?.text())).toBe(
      `${origin}/`,
    )
  })

  it('cleans up only its own obsolete caches and waits for client claiming', async () => {
    const w = worker()
    let resolveClaim!: () => void
    w.claim.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClaim = resolve
      }),
    )
    let settled = false
    const activation = w
      .dispatch('activate')
      .done()
      .then(() => {
        settled = true
      })
    await vi.waitFor(() => expect(w.claim).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    resolveClaim()
    await activation
    expect(w.cacheStorage.delete).toHaveBeenCalledExactlyOnceWith(
      'vibe-translate-static-v3',
    )
    expect(w.claim).toHaveBeenCalledOnce()
  })

  it.each([
    '/api',
    '/api/auth/get-session',
    '/api/share/token',
    'https://external.example/asset.js',
  ])('does not intercept or cache %s', (path) => {
    const w = worker()
    expect(w.dispatch('fetch', path).response).toBeUndefined()
    expect(w.fetcher).not.toHaveBeenCalled()
  })

  it('does not intercept writes and handles runtime storage failure', async () => {
    const w = worker()
    expect(
      w.dispatch('fetch', '/assets/main.js', 'cors', 'POST').response,
    ).toBeUndefined()
    const response = new Response('asset')
    Object.defineProperty(response, 'type', { value: 'basic' })
    w.fetcher.mockResolvedValue(response)
    w.cache.put.mockRejectedValueOnce(new Error('Quota exceeded'))
    expect(
      await (await w.dispatch('fetch', '/assets/new.js').done())?.text(),
    ).toBe('asset')
  })
})
