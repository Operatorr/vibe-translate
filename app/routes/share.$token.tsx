import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { SharedThreadView } from '@/components/app/shared-thread-view'
import { Icon } from '@/components/vibe-design/icon'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import { ApiError, apiFetch } from '@/lib/api'
import type { SharedThread } from '@/lib/types'

export const Route = createFileRoute('/share/$token')({
  component: SharePage,
})

// Public, read-only view of a shared Thread. No auth: the token is the
// capability. See api/app.ts → GET /api/share/:token.
function SharePage() {
  const { token } = Route.useParams()
  const frame = useVibeFrame('/')
  const query = useQuery({
    queryKey: ['share-public', token],
    queryFn: () => apiFetch<SharedThread>(`/api/share/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: 60_000,
  })

  return (
    <div className="app-shell share-shell">
      <header className="vt-topnav">
        <div className="vt-topnav__left">
          <Link className="vt-mark" to={'/' as never}>
            <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
              <defs>
                <mask id="sh-notch">
                  <rect width="64" height="64" fill="white" />
                  <circle cx="44" cy="22" r="14" fill="black" />
                </mask>
              </defs>
              <circle cx="32" cy="32" r="28" fill="currentColor" mask="url(#sh-notch)" />
              <circle cx="44" cy="22" r="6" fill="#1f7aff" />
            </svg>
            <span className="vt-mark__name">Vibe Translate</span>
          </Link>
          <span className="share-badge">
            <Icon name="link" /> Shared thread
          </span>
        </div>
        <div className="vt-topnav__right">
          <button className="vt-iconbtn" aria-label="Toggle theme" onClick={frame.onToggleTheme}>
            <Icon name={frame.theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Link className="vt-btn vt-btn--primary" style={{ padding: '8px 14px', fontSize: 13 }} to={'/app' as never}>
            Start translating
          </Link>
        </div>
      </header>

      {query.isLoading && (
        <div className="welcome">
          <Icon name="loader" className="vt-spin" style={{ width: 24, height: 24, color: 'var(--fg-subtle)' }} />
        </div>
      )}
      {query.error && (
        <div className="welcome">
          <Icon name="link-off" style={{ width: 32, height: 32, color: 'var(--fg-subtle)' }} />
          <h3 className="welcome__title">
            {query.error instanceof ApiError && query.error.status === 404
              ? 'This link is no longer available'
              : 'Could not load this thread'}
          </h3>
          <p className="welcome__sub">
            The owner may have disabled sharing, or the link was mistyped.
          </p>
          <Link className="vt-btn vt-btn--primary" to={'/' as never}>
            Go to Vibe Translate
          </Link>
        </div>
      )}
      {query.data && <SharedThreadView data={query.data} />}
    </div>
  )
}
