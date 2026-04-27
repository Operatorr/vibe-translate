import { createFileRoute } from '@tanstack/react-router'

import { MarketingShell } from '@/components/marketing/marketing-shell'

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
})

function PricingPage() {
  return (
    <MarketingShell>
      <main className="mx-auto max-w-[72rem] px-6 py-16">
        <h1 className="text-4xl font-semibold">Pricing</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {['Starter', 'Pro', 'Team'].map((plan) => (
            <article key={plan} className="rounded-lg border border-border bg-panel p-6">
              <h2 className="text-xl font-semibold">{plan}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Plan limits and Dodo checkout integration are scaffolded in the API layer.
              </p>
            </article>
          ))}
        </div>
      </main>
    </MarketingShell>
  )
}
