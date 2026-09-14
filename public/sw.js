/* global self, caches, URL, fetch */

// Vibe Translate service worker.
//   - App shell + static assets: cache-first (Vite emits content-hashed files
//     under /assets/, so a cached copy is always the right copy).
//   - Navigations: network-first, falling back to the cached shell so the
//     installed PWA opens offline (TanStack Query rehydrates list data from
//     IndexedDB; see app/lib/query-cache-persist.tsx).
//   - /api/*: never cached — every response is user-scoped or metered.
// Bump CACHE_NAME whenever a precached file changes — the list OR the bytes of
// an entry (icons, manifest) — since those URLs are not content-hashed.

const CACHE_NAME = 'vibe-translate-static-v3'
const SHELL_URL = '/'
const PRECACHE = [
  SHELL_URL,
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // The shell is the offline fallback. If it can't be cached, fail the
      // install: the previous worker stays active and the browser retries,
      // instead of activating a worker that opens to a blank page offline.
      await cache.add(SHELL_URL)
      // Icons/manifest are nice-to-have; one missing file must not block updates.
      await Promise.allSettled(
        PRECACHE.filter((url) => url !== SHELL_URL).map((url) =>
          cache.add(url),
        ),
      )
      await self.skipWaiting()
    }),
  )
})

// Runtime cache writes are opportunistic (quota, private mode); never let them
// surface as unhandled rejections.
const putInCache = (key, response) =>
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(key, response))
    .catch(() => undefined)

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the shell fresh for the offline fallback.
          if (response.ok) {
            void putInCache(SHELL_URL, response.clone())
          }
          return response
        })
        .catch(() => caches.match(SHELL_URL)),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (
          response.ok &&
          (response.type === 'basic' || response.type === 'cors')
        ) {
          void putInCache(request, response.clone())
        }
        return response
      })
    }),
  )
})
