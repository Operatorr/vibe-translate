import { createFileRoute } from '@tanstack/react-router'

import { MarketingShell } from '@/components/marketing/marketing-shell'

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
})

function ChangelogPage() {
  return (
    <MarketingShell>
      <main className="mx-auto max-w-[48rem] px-6 py-16">
        <h1 className="text-4xl font-semibold">Changelog</h1>
        <p className="mt-4 leading-7 text-muted">Initial scaffold for VibeTranslate.</p>
      </main>
    </MarketingShell>
  )
}
