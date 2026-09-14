import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { SharedThreadView } from '@/components/app/shared-thread-view'
import { Icon } from '@/components/vibe-design/icon'
import type { PaletteItem } from '@/components/vibe-design/palette-items'
import { CommandPalette } from '@/components/vibe-design/shell'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import { ApiError, apiFetch } from '@/lib/api'
import { sharedThreadSchema } from '@/lib/schemas'

export const Route = createFileRoute('/share/$token')({
  component: SharePage,
})

// Mirrors the worker's check so junk tokens never leave the browser.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

const PALETTE_ITEMS: PaletteItem[] = [
  { id: 'app', label: 'Start translating', icon: 'languages', hint: null },
  {
    id: 'home',
    label: 'Go to Vibe Translate',
    icon: 'external-link',
    hint: null,
  },
  { id: 'theme', label: 'Toggle theme', icon: 'sun-moon', hint: null },
]

// Public, read-only view of a shared Thread. No auth: the token is the
// capability. See api/app.ts → GET /api/share/:token.
function SharePage() {
  const { token } = Route.useParams()
  const frame = useVibeFrame('/')
  const validToken = TOKEN_RE.test(token)
  const query = useQuery({
    queryKey: ['share-public', token],
    // Validate the untrusted payload so a malformed row degrades instead of
    // crashing the page.
    queryFn: async () =>
      sharedThreadSchema.parse(
        await apiFetch<unknown>(`/api/share/${encodeURIComponent(token)}`),
      ),
    enabled: validToken,
    retry: false,
    // The API is no-store so a revoked link stops resolving at once; don't let
    // an in-memory copy keep serving it on back-navigation.
    staleTime: 0,
    gcTime: 0,
  })

  // Keep the capability URL out of search indexes and Referer headers. The
  // static `public/_headers` rules do the same at the edge; this covers any
  // host (and local dev) that doesn't apply them.
  useEffect(() => {
    const tags = [
      ['robots', 'noindex, nofollow'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => {
      const meta = document.createElement('meta')
      meta.name = name
      meta.content = content
      document.head.appendChild(meta)
      return meta
    })
    return () => tags.forEach((meta) => meta.remove())
  }, [])
  const notFound =
    !validToken ||
    (query.error instanceof ApiError && query.error.status === 404)

  const onPalettePick = (id: string) => {
    if (id === 'theme') frame.onToggleTheme()
    else if (id === 'app') frame.onNavigate('/app')
    else if (id === 'home') frame.onNavigate('/')
  }

  return (
    <div className="app-shell share-shell">
      <header className="vt-topnav">
        <div className="vt-topnav__left">
          <Link className="vt-mark" to="/">
            <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
              <defs>
                <mask id="sh-notch">
                  <rect width="64" height="64" fill="white" />
                  <circle cx="44" cy="22" r="14" fill="black" />
                </mask>
              </defs>
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="currentColor"
                mask="url(#sh-notch)"
              />
              <circle cx="44" cy="22" r="6" fill="#1f7aff" />
            </svg>
            <span className="vt-mark__name">Vibe Translate</span>
          </Link>
          <span className="share-badge">
            <Icon name="link" /> Shared thread
          </span>
        </div>
        <div className="vt-topnav__right">
          <button
            className="vt-iconbtn"
            aria-label="Toggle theme"
            onClick={frame.onToggleTheme}
          >
            <Icon name={frame.theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Link
            className="vt-btn vt-btn--primary"
            style={{ padding: '8px 14px', fontSize: 13 }}
            to="/app"
          >
            Start translating
          </Link>
        </div>
      </header>

      {query.isLoading && (
        <div className="welcome">
          <Icon
            name="loader"
            className="vt-spin"
            style={{ width: 24, height: 24, color: 'var(--fg-subtle)' }}
          />
        </div>
      )}
      {(notFound || query.error) && (
        <div className="welcome">
          <Icon
            name="link-off"
            style={{ width: 32, height: 32, color: 'var(--fg-subtle)' }}
          />
          <h3 className="welcome__title">
            {notFound
              ? 'This link is no longer available'
              : 'Could not load this thread'}
          </h3>
          <p className="welcome__sub">
            {notFound
              ? 'The owner may have disabled sharing, or the link was mistyped.'
              : 'Something went wrong on our side. Try again in a moment.'}
          </p>
          {notFound ? (
            <Link className="vt-btn vt-btn--primary" to="/">
              Go to Vibe Translate
            </Link>
          ) : (
            <button
              type="button"
              className="vt-btn vt-btn--primary"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {query.data && <SharedThreadView data={query.data} />}

      <CommandPalette
        open={frame.paletteOpen}
        onClose={() => frame.setPaletteOpen(false)}
        onPick={onPalettePick}
        items={PALETTE_ITEMS}
      />
    </div>
  )
}
