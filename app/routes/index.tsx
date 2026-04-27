import { Link, createFileRoute } from '@tanstack/react-router'

import { TranslationDemo } from '@/components/landing/translation-demo'
import { MarketingShell } from '@/components/marketing/marketing-shell'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-[72rem] items-center gap-10 px-6 py-16 md:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-accent">VibeTranslate</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-6xl">
            AI translation workspaces for fast-moving teams.
          </h1>
          <p className="mt-5 max-w-[36rem] text-lg leading-8 text-muted">
            Organize translation chats, preserve context, and turn voice notes into structured
            translation instructions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="button-primary" to={'/app' as never}>
              Open app
            </Link>
            <Link className="button-secondary" to={'/pricing' as never}>
              View pricing
            </Link>
          </div>
        </div>
        <TranslationDemo />
      </section>
    </MarketingShell>
  )
}
