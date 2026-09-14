import type { Character, Segment, VibeStop } from '@/lib/types'

import {
  LANG_NAME,
  getVibesForLang,
} from '@/components/vibe-design/design-data'

const LANGUAGE_NAMES = LANG_NAME as Record<string, string>

type ExportInput = {
  title: string
  character: Pick<
    Character,
    'name' | 'sourceLanguage' | 'targetLanguage' | 'defaultVibe'
  >
  segments: Array<
    Pick<Segment, 'sourceText' | 'targetText' | 'createdAt'> & {
      vibe: VibeStop | null
    }
  >
  // Optional public share URL to embed in the footer.
  shareUrl?: string | null
}

const langName = (code: string) => LANGUAGE_NAMES[code] ?? code

// User-authored single-line values (thread title, character name): collapse
// newlines so they can't start new blocks, and escape Markdown/HTML control
// characters so they can't inject headings, links, emphasis, or raw HTML.
export function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_{}[\]()#+!<>|~]/g, '\\$&')
}

// Multi-line quoted text: keep line breaks inside the blockquote, but escape
// `<` so translations can't switch the renderer into raw-HTML mode.
const quote = (text: string) =>
  `> ${text.replace(/</g, '\\<').replace(/\n/g, '\n> ')}`

// Only http(s) links, with parentheses percent-encoded so the URL can't close
// the Markdown link early.
export function safeLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29')
  } catch {
    return null
  }
}

// Render a Thread as a Markdown document: one section per Segment, oldest
// first, with the Vibe stop label localized for the target language.
export function threadToMarkdown(input: ExportInput): string {
  const { character, segments, title } = input
  const vibes = getVibesForLang(character.targetLanguage)
  const vibeLabel = (id: VibeStop | null) =>
    vibes.find((v) => v.id === (id ?? character.defaultVibe))?.label ??
    id ??
    character.defaultVibe

  const lines: string[] = [
    `# ${escapeInline(title) || 'Untitled thread'}`,
    ``,
    `- **Character:** ${escapeInline(character.name)}`,
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
    lines.push(quote(seg.sourceText))
    lines.push(``)
    lines.push(`**${langName(character.targetLanguage)}**`)
    lines.push(``)
    lines.push(quote(seg.targetText))
    lines.push(``)
    lines.push(`_${new Date(seg.createdAt).toLocaleString()}_`)
    lines.push(``)
  })

  const link = safeLinkUrl(input.shareUrl)
  lines.push(`---`)
  lines.push(``)
  lines.push(
    link
      ? `Exported from [Vibe Translate](${link}).`
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
      .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'thread'
  )
}

// Trigger a browser download of a text file.
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/markdown',
) {
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
