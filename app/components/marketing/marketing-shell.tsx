import { Link } from '@tanstack/react-router'
import type { PropsWithChildren } from 'react'

export function MarketingShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-[72rem] items-center justify-between px-6">
          <Link className="font-semibold" to={'/' as never}>
            VibeTranslate
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link className="text-muted hover:text-foreground" to={'/pricing' as never}>
              Pricing
            </Link>
            <Link className="text-muted hover:text-foreground" to={'/changelog' as never}>
              Changelog
            </Link>
            <Link className="button-primary" to={'/app' as never}>
              App
            </Link>
          </div>
        </nav>
      </header>
      {children}
    </div>
  )
}
