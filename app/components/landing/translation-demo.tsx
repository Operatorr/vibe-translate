export function TranslationDemo() {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 shadow-soft">
      <div className="space-y-3">
        <div className="rounded-md bg-surface p-4">
          <p className="text-sm text-muted">Source</p>
          <p className="mt-2">Ship the release note in a warmer, more natural Thai tone.</p>
        </div>
        <div className="rounded-md bg-accent-soft p-4">
          <p className="text-sm text-accent">Translation brief</p>
          <p className="mt-2">Friendly product voice, concise, preserve technical nouns.</p>
        </div>
        <div className="rounded-md bg-surface p-4">
          <p className="text-sm text-muted">Output</p>
          <p className="mt-2">Hello world translation output.</p>
        </div>
      </div>
    </div>
  )
}
