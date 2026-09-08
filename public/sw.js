/* global self, caches, URL, fetch */

// Vibe Translate service worker.
//   - App shell + static assets: cache-first (Vite emits content-hashed files
//     under /assets/, so a cached copy is always the right copy).
//   - Navigations: network-first, falling back to the cached shell so the
//     installed PWA opens offline (TanStack Query rehydrates list data from
//     IndexedDB; see app/lib/query-cache-persist.tsx).
//   - /api/*: never cached — every response is user-scoped or metered.
// Bump CACHE_NAME whenever the precache list changes.

const CACHE_NAME = 'vibe-translate-static-v2'
const SHELL_URL = '/'
const PRECACHE = [
  SHELL_URL,
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url)))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
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
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy))
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
        if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
