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
