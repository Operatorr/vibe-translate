export function StartupScreen() {
  return (
    <main className="startup-screen" aria-label="Vibe Translate">
      <div className="startup-screen__content">
        <div className="startup-screen__mark" aria-hidden="true">
          <img src="/icon.svg" width="80" height="80" alt="" />
        </div>
        <h1 className="startup-screen__title">Vibe Translate</h1>
        <p className="startup-screen__tagline">Your words. Your vibe.</p>
        <div className="startup-screen__status" role="status">
          <div className="startup-screen__spectrum" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <p>Getting things ready…</p>
        </div>
      </div>
    </main>
  )
}
