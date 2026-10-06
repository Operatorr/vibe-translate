/* global self, caches, URL, fetch, Response, Request */

// Vite fills in the version and every JS/CSS/asset URL at build time.
const CACHE_PREFIX = 'vibe-translate-static-'
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_VERSION__`
const BUILD_ASSETS = /* __BUILD_ASSETS__ */ []
const SHELL_URL = '/'
const BUILD_SHELL = /* __BUILD_SHELL__ */ ''
const OPTIONAL_ASSETS = /* __OPTIONAL_ASSETS__ */ []

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Integrity rejects missing assets served as SPA fallback HTML, or bytes
      // from another release. addAll commits only when every asset succeeds.
      await cache.addAll(
        BUILD_ASSETS.map(
          ({ url, integrity }) =>
            new Request(url, { cache: 'reload', integrity }),
        ),
      )
      // The HTML travels inside this worker, so it cannot come from a newer deploy.
      await cache.put(
        SHELL_URL,
        new Response(BUILD_SHELL, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      )
      await Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(url)))
      // Updates wait for open tabs to close. Replacing the worker immediately
      // would delete chunks still needed by an older running app.
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || request.method !== 'GET') return
  // Never cache API/auth responses, shared content, or arbitrary URLs.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match(SHELL_URL)) || Response.error()
      }),
    )
    // Keep the precached shell paired with this build's assets. An online
    // navigation may serve a newer deployment while its worker is waiting.
    return
  }

  if (
    !url.pathname.startsWith('/assets/') &&
    !OPTIONAL_ASSETS.includes(url.pathname)
  )
    return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // These are public, same-origin files. Some static servers emit Vary:
      // Origin; a module request carries Origin while a precache request may
      // not. Match by URL so that difference cannot break an offline launch.
      const cached = await cache.match(request, { ignoreVary: true })
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') {
        event.waitUntil(
          cache.put(request, response.clone()).catch(() => undefined),
        )
      }
      return response
    }),
  )
})
