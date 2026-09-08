import type { Character, Segment, VibeStop } from '@/lib/types'

import { LANG_NAME, getVibesForLang } from '@/components/vibe-design/design-data'

const LANGUAGE_NAMES = LANG_NAME as Record<string, string>

type ExportInput = {
  title: string
  character: Pick<Character, 'name' | 'sourceLanguage' | 'targetLanguage' | 'defaultVibe'>
  segments: Array<Pick<Segment, 'sourceText' | 'targetText' | 'createdAt'> & { vibe: VibeStop | null }>
  // Optional public share URL to embed in the footer.
  shareUrl?: string | null
}

const langName = (code: string) => LANGUAGE_NAMES[code] ?? code

// Render a Thread as a Markdown document: one section per Segment, oldest
// first, with the Vibe stop label localized for the target language.
export function threadToMarkdown(input: ExportInput): string {
  const { character, segments, title } = input
  const vibes = getVibesForLang(character.targetLanguage)
  const vibeLabel = (id: VibeStop | null) =>
    vibes.find((v) => v.id === (id ?? character.defaultVibe))?.label ?? id ?? character.defaultVibe

  const lines: string[] = [
    `# ${title}`,
    ``,
    `- **Character:** ${character.name}`,
    `- **Languages:** ${langName(character.sourceLanguage)} → ${langName(character.targetLanguage)}`,
    `- **Default vibe:** ${vibeLabel(character.defaultVibe)}`,
    `- **Translations:** ${segments.length}`,
    `- **Exported:** ${new Date().toISOString()}`,
    ``,
  ]

  segments.forEach((seg, i) => {
    lines.push(`## ${String(i + 1).padStart(2, '0')} · ${vibeLabel(seg.vibe)}`)
    lines.push(``)
    lines.push(`**${langName(character.sourceLanguage)}**`)
    lines.push(``)
    lines.push(`> ${seg.sourceText.replace(/\n/g, '\n> ')}`)
    lines.push(``)
    lines.push(`**${langName(character.targetLanguage)}**`)
    lines.push(``)
    lines.push(`> ${seg.targetText.replace(/\n/g, '\n> ')}`)
    lines.push(``)
    lines.push(`<sub>${new Date(seg.createdAt).toLocaleString()}</sub>`)
    lines.push(``)
  })

  lines.push(`---`)
  lines.push(``)
  lines.push(
    input.shareUrl
      ? `Exported from [Vibe Translate](${input.shareUrl}).`
      : `Exported from Vibe Translate.`,
  )
  lines.push(``)
  return lines.join('\n')
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'thread'
  )
}

// Trigger a browser download of a text file.
export function downloadTextFile(filename: string, text: string, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
