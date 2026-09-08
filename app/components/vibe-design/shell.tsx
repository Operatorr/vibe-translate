import { Link } from '@tanstack/react-router'
import * as React from 'react'

import { Icon } from './icon'
import { DEFAULT_PALETTE_ITEMS, type PaletteItem } from './palette-items'
import type { NavigateFn, VibeRoute } from './use-vibe-frame'


export const CommandPalette = ({
  open,
  onClose,
  onPick,
  items = DEFAULT_PALETTE_ITEMS,
}: {
  open: boolean
  onClose: () => void
  onPick?: (id: string) => void
  items?: PaletteItem[]
}) => {
  const [q, setQ] = React.useState('')
  const [cursor, setCursor] = React.useState(0)
  const filtered = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
  React.useEffect(() => {
    if (open) {
      setQ('')
      setCursor(0)
    }
  }, [open])
  React.useEffect(() => setCursor(0), [q])
  if (!open) return null
  const pick = (id: string) => {
    onPick?.(id)
    onClose()
  }
  return (
    <div className="vt-palette-scrim" onClick={onClose}>
      <div
        className="vt-palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vt-palette__head">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Search characters, threads, or run a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(filtered.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter' && filtered[cursor]) {
                e.preventDefault()
                pick(filtered[cursor].id)
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="vt-palette__list">
          {filtered.length === 0 && <div className="vt-palette__empty">No results.</div>}
          {filtered.map((i, idx) => (
            <button
              key={i.id}
              className={'vt-palette__item ' + (idx === cursor ? 'is-cursor' : '')}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => pick(i.id)}
            >
              <Icon name={i.icon} />
              <span className="vt-palette__label">{i.label}</span>
              {i.hint ? (
                <kbd className="vt-palette__hint">{i.hint}</kbd>
              ) : i.group ? (
                <span className="vt-palette__hint">{i.group}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="vt-palette__foot">
          <span className="vt-eyebrow">COMMANDS</span>
          <span className="vt-palette__count">
            {filtered.length} of {items.length}
          </span>
        </div>
      </div>
    </div>
  )
}

export const SiteNav = ({
  theme,
  onToggleTheme,
  route,
  onNavigate,
  onOpenPalette,
  account,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  route: VibeRoute
  onNavigate: NavigateFn
  onOpenPalette: () => void
  // Right-hand account slot on the app route (Clerk's UserButton).
  account?: React.ReactNode
}) => {
  const navLink = (to: VibeRoute, label: string) => (
    <a
      className={'vt-navlink ' + (route === to ? 'vt-navlink--active' : '')}
      href={to}
      onClick={(e) => {
        e.preventDefault()
        onNavigate(to)
      }}
    >
      {label}
    </a>
  )
  return (
    <header className="vt-topnav">
      <div className="vt-topnav__left">
        <a
          className="vt-mark"
          href="/"
          onClick={(e) => {
            e.preventDefault()
            onNavigate('/')
          }}
        >
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <mask id="sn-notch">
                <rect width="64" height="64" fill="white" />
                <circle cx="44" cy="22" r="14" fill="black" />
              </mask>
            </defs>
            <circle cx="32" cy="32" r="28" fill="currentColor" mask="url(#sn-notch)" />
            <circle cx="44" cy="22" r="6" fill="#1f7aff" />
          </svg>
          <span className="vt-mark__name">Vibe Translate</span>
        </a>
        <nav className="vt-topnav__nav">
          {navLink('/', 'Product')}
          {navLink('/pricing', 'Pricing')}
          {navLink('/app', 'App')}
          <Link className="vt-navlink" to={'/changelog' as never}>
            Changelog
          </Link>
        </nav>
      </div>
      <div className="vt-topnav__right">
        {route === '/app' ? (
          <button className="vt-cmdk" onClick={onOpenPalette} aria-label="Search or jump to">
            <Icon name="search" />
            <span>Search or jump to</span>
            <kbd>⌘K</kbd>
          </button>
        ) : (
          <a
            className="vt-navlink"
            href="/app"
            onClick={(e) => {
              e.preventDefault()
              onNavigate('/app')
            }}
          >
            Sign in
          </a>
        )}
        <button className="vt-iconbtn" aria-label="Toggle theme" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {route !== '/app' && (
          <button
            className="vt-btn vt-btn--primary"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => onNavigate('/app')}
          >
            Start translating
          </button>
        )}
        {route === '/app' && <div className="vt-account">{account}</div>}
      </div>
    </header>
  )
}
