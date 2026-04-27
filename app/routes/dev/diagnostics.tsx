import { createFileRoute } from '@tanstack/react-router'

import { useApiQuery } from '@/hooks/use-api-query'

export const Route = createFileRoute('/dev/diagnostics')({
  component: DiagnosticsPage,
})

function DiagnosticsPage() {
  const diagnostics = useApiQuery(['diagnostics'], '/api/diagnostics')

  return (
    <main className="mx-auto max-w-[48rem] px-6 py-16">
      <h1 className="text-3xl font-semibold">Diagnostics</h1>
      <pre className="mt-6 overflow-auto rounded-lg border border-border bg-panel p-4 text-sm">
        {JSON.stringify(diagnostics.data ?? diagnostics.error ?? { status: 'loading' }, null, 2)}
      </pre>
    </main>
  )
}
