import { createFileRoute } from '@tanstack/react-router'

import { MarketingShell } from '@/components/marketing/marketing-shell'

export const Route = createFileRoute('/legal')({
  component: LegalPage,
})

function LegalPage() {
  return (
    <MarketingShell>
      <main className="mx-auto max-w-[48rem] px-6 py-16">
        <h1 className="text-4xl font-semibold">Legal</h1>
        <p className="mt-4 leading-7 text-muted">
          Add terms, privacy policy, data processing, and subscription disclosures here.
        </p>
      </main>
    </MarketingShell>
  )
}
