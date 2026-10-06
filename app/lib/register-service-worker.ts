export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        await Promise.all(
          registrations
            .filter((registration) =>
              [
                registration.active,
                registration.waiting,
                registration.installing,
              ].some(
                (worker) =>
                  worker?.scriptURL === new URL('/sw.js', location.origin).href,
              ),
            )
            .map((registration) => registration.unregister()),
        )
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(
            keys
              .filter((key) => key.startsWith('vibe-translate-static-'))
              .map((key) => caches.delete(key)),
          )
        }
      })
      .catch((error) => console.error('Service worker cleanup failed', error))
    return
  }

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((error) => {
        console.error('Service worker registration failed', error)
      })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
