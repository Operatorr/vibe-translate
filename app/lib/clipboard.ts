// Copy text with a legacy fallback for contexts where the async Clipboard API
// is unavailable or denied (embedded webviews, non-secure origins).
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
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  el.remove()
  if (!ok) throw new Error('Copy failed')
}
