import { describe, expect, it } from 'vitest'

import { escapeInline, safeLinkUrl, threadToMarkdown } from '../markdown-export'

const character = {
  name: 'Oba-chan',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  defaultVibe: 'casual' as const,
}

describe('threadToMarkdown', () => {
  it('cannot inject blocks through the title', () => {
    const md = threadToMarkdown({
      title: 'Recipe\n\n# Injected',
      character,
      segments: [],
    })
    const headings = md.split('\n').filter((line) => line.startsWith('#'))
    expect(headings).toEqual(['# Recipe \\# Injected'])
  })

  it('escapes links and raw HTML in names', () => {
    expect(escapeInline('[x](javascript:alert(1)) <b>')).toBe(
      '\\[x\\]\\(javascript:alert\\(1\\)\\) \\<b\\>',
    )
  })

  it('uses Markdown emphasis for dates, not raw HTML', () => {
    const md = threadToMarkdown({
      title: 't',
      character,
      segments: [
        {
          sourceText: 'hi',
          targetText: '<script>',
          vibe: null,
          createdAt: '2026-09-14T10:00:00.000Z',
        },
      ],
    })
    expect(md).not.toContain('<sub>')
    expect(md).toContain('> \\<script>')
  })

  it('only links http(s) share URLs', () => {
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(safeLinkUrl('https://vibe.example/share/a(b)')).toBe(
      'https://vibe.example/share/a%28b%29',
    )
    const md = threadToMarkdown({
      title: 't',
      character,
      segments: [],
      shareUrl: 'javascript:x',
    })
    expect(md).toContain('Exported from Vibe Translate.')
  })
})
