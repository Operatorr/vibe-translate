// Avatar initials for a Character name. CJK: first character; Latin: up to two
// initials. Never returns an empty string.
export function initialsFor(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  if (/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(trimmed[0]))
    return trimmed[0]
  return (
    trimmed
      .split(/[\s·-]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}
