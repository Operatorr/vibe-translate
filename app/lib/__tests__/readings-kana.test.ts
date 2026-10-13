import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadReadings } from '../readings'

// Kana with the real kuromoji dictionary, read from the installed package.
const dictDir = join(
  dirname(createRequire(import.meta.url).resolve('@patdx/kuromoji')),
  '..',
  'dict',
)

beforeAll(() => {
  vi.stubGlobal('__KUROMOJI_DICT_URL__', '/dict/kuromoji-test/')
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(readFileSync(join(dictDir, basename(url)))),
  )
})

const kana = (tokens: string[]) => loadReadings(tokens, 'ja-JP')
const bases = (parts: { base: string }[][]) =>
  parts.map((token) => token.map((part) => part.base).join(''))

describe('loadReadings (Kana, real dictionary)', { timeout: 30_000 }, () => {
  it.each([[['💖💖あ']], [['\r\n日本語\t💖𠮷\n']], [['💖', '💖あ', '日本']]])(
    'keeps every character of %j',
    async (tokens) => {
      expect(bases(await kana(tokens))).toEqual(tokens)
    },
  )

  it('reads words in sentence context, whatever the alignment split', async () => {
    expect(await kana(['お', '金'])).toEqual([
      [{ base: 'お' }],
      [{ base: '金', rt: 'かね' }],
    ])
    expect(await kana(['お金'])).toEqual([
      [{ base: 'お' }, { base: '金', rt: 'かね' }],
    ])
    expect(await kana(['御飯'])).toEqual([[{ base: '御飯', rt: 'ごはん' }]])
    // ごはん cannot be divided between 御 and 飯, so neither is annotated.
    expect(await kana(['御', '飯'])).toEqual([
      [{ base: '御' }],
      [{ base: '飯' }],
    ])
  })

  it('puts furigana over kanji and leaves okurigana bare', async () => {
    expect(await kana(['手紙を', '書いた'])).toEqual([
      [{ base: '手紙', rt: 'てがみ' }, { base: 'を' }],
      [{ base: '書', rt: 'か' }, { base: 'いた' }],
    ])
  })
})
