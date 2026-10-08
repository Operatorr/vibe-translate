// Copy text with a legacy fallback for contexts where the async Clipboard API
// is unavailable or denied (embedded webviews, non-secure origins). The
// fallback relies on `document.execCommand('copy')`, which is deprecated but
// still the only synchronous option in those contexts.
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // fall through
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.setAttribute('aria-hidden', 'true')
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  try {
    el.select()
    if (!document.execCommand('copy')) throw new Error('Copy failed')
  } finally {
    el.remove()
  }
}

// Copy text that is still being prepared. Clipboard writes need transient user
// activation, and WebKit rejects writes started after an await in the click
// handler, so the write starts synchronously (call this before any await) with
// a promise-backed item that resolves once the text is ready. Rejects when the
// browser can't defer the write, so callers can offer a second-click copy.
export async function copyTextWhenReady(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
    throw new Error('Deferred clipboard writes are unsupported')
  const blob = text.then((value) => new Blob([value], { type: 'text/plain' }))
  // The caller reports a preparation failure; don't also surface it here.
  blob.catch(() => {})
  await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
}
