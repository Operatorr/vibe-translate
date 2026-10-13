import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  furigana,
  kanaSpans,
  loadReadings,
  readingScriptFor,
  spansToTokens,
  splitByTokens,
  toHiragana,
} from '../readings'

// A stand-in tokenizer builder that drives the real dictionary loader. The
// real dictionary is exercised in readings-kana.test.ts.
const kuromoji = vi.hoisted(() => ({
  built: 0,
  files: ['base.dat.gz', 'cc.dat.gz'],
  buffers: [] as ArrayBuffer[],
}))
vi.mock('@patdx/kuromoji', () => ({
  TokenizerBuilder: class {
    constructor(
      private options: {
        loader: { loadArrayBuffer(file: string): Promise<ArrayBuffer> }
      },
    ) {}
    async build() {
      kuromoji.built++
      kuromoji.buffers = await Promise.all(
        kuromoji.files.map((file) => this.options.loader.loadArrayBuffer(file)),
      )
      return { tokenize: () => [] }
    }
  },
}))

describe('readingScriptFor', () => {
  it('maps Chinese to Pinyin and Japanese to Kana', () => {
    expect(readingScriptFor('zh-TW')).toBe('pinyin')
    expect(readingScriptFor('zh-CN')).toBe('pinyin')
    expect(readingScriptFor('ja-JP')).toBe('kana')
    expect(readingScriptFor('th-TH')).toBeNull()
  })
})

describe('furigana', () => {
  it('puts the reading over the kanji and leaves okurigana bare', () => {
    expect(furigana('書い', 'カイ')).toEqual([
      { base: '書', rt: 'か' },
      { base: 'い' },
    ])
    expect(furigana('お疲れ様', 'オツカレサマ')).toEqual([
      { base: 'お' },
      { base: '疲', rt: 'つか' },
      { base: 'れ' },
      { base: '様', rt: 'さま' },
    ])
  })

  it('keeps a compound under one reading', () => {
    expect(furigana('到着', 'トウチャク')).toEqual([
      { base: '到着', rt: 'とうちゃく' },
    ])
  })

  it('skips kana-only, unknown, and unreadable morphemes', () => {
    expect(furigana('レシピ', 'レシピ')).toEqual([{ base: 'レシピ' }])
    expect(furigana('3', undefined)).toEqual([{ base: '3' }])
    expect(furigana('時', '*')).toEqual([{ base: '時' }])
  })

  it('falls back to one reading when the kana do not line up', () => {
    expect(furigana('行った', 'オコナッタ')).toEqual([
      { base: '行', rt: 'おこな' },
      { base: 'った' },
    ])
    expect(furigana('書く', 'ヨム')).toEqual([{ base: '書く', rt: 'よむ' }])
  })

  it('converts katakana readings to hiragana', () => {
    expect(toHiragana('トウキョウ')).toBe('とうきょう')
  })
})

describe('splitByTokens', () => {
  it('slices readings onto tokens and merges unread runs', () => {
    expect(
      splitByTokens(['火車', '?!'], ['huǒ', 'chē', undefined, undefined]),
    ).toEqual([
      [
        { base: '火', rt: 'huǒ' },
        { base: '車', rt: 'chē' },
      ],
      [{ base: '?!' }],
    ])
  })
})

describe('loadReadings (Pinyin)', () => {
  it('reads Traditional characters with their Simplified polyphones', async () => {
    const parts = await loadReadings(
      ['火車', '什麼時候', '會', '到', '?'],
      'zh-TW',
    )
    expect(parts).toEqual([
      [
        { base: '火', rt: 'huǒ' },
        { base: '車', rt: 'chē' },
      ],
      [
        { base: '什', rt: 'shén' },
        { base: '麼', rt: 'me' },
        { base: '時', rt: 'shí' },
        { base: '候', rt: 'hòu' },
      ],
      [{ base: '會', rt: 'huì' }],
      [{ base: '到', rt: 'dào' }],
      [{ base: '?' }],
    ])
  })

  it('leaves Latin text and digits without readings', async () => {
    const parts = await loadReadings(['我有', ' iPhone 15 ', '了'], 'zh-CN')
    expect(parts.map((token) => token.map((p) => p.base).join(''))).toEqual([
      '我有',
      ' iPhone 15 ',
      '了',
    ])
    expect(parts[1]).toEqual([{ base: ' iPhone 15 ' }])
  })
})

describe('kanaSpans and spansToTokens', () => {
  it('keeps the original text when the tokenizer drops characters', () => {
    const text = '💖💖あ日本'
    const spans = kanaSpans(text, [
      { surface_form: '💖💖' },
      { surface_form: '日本', reading: 'ニホン' },
    ])
    expect(spansToTokens([text], spans)).toEqual([
      [{ base: '💖💖あ' }, { base: '日本', rt: 'にほん' }],
    ])
  })

  it('places sentence-level readings on alignment tokens', () => {
    const text = 'お金がない'
    const spans = kanaSpans(text, [
      { surface_form: 'お金', reading: 'オカネ' },
      { surface_form: 'が', reading: 'ガ' },
      { surface_form: 'ない', reading: 'ナイ' },
    ])
    expect(spansToTokens(['お', '金が', 'ない'], spans)).toEqual([
      [{ base: 'お' }],
      [{ base: '金', rt: 'かね' }, { base: 'が' }],
      [{ base: 'ない' }],
    ])
  })

  it('leaves a reading that straddles two tokens unannotated', () => {
    const spans = kanaSpans('御飯', [
      { surface_form: '御飯', reading: 'ゴハン' },
    ])
    expect(spansToTokens(['御', '飯'], spans)).toEqual([
      [{ base: '御' }],
      [{ base: '飯' }],
    ])
    expect(spansToTokens(['御飯'], spans)).toEqual([
      [{ base: '御飯', rt: 'ごはん' }],
    ])
  })
})

describe('loadReadings (Kana dictionary loading)', () => {
  const ok = (body: BodyInit, type = 'application/octet-stream') =>
    new Response(body, { headers: { 'Content-Type': type } })
  let fetcher: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>
  let load: typeof loadReadings

  beforeEach(async () => {
    kuromoji.built = 0
    kuromoji.buffers = []
    fetcher = vi.fn(async () => ok(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('__KUROMOJI_DICT_URL__', '/dict/kuromoji-test/')
    // A fresh module per test: the tokenizer is a module-level singleton.
    vi.resetModules()
    ;({ loadReadings: load } = await import('../readings'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const bytes = () => kuromoji.buffers.map((b) => [...new Uint8Array(b)])

  it('inflates raw gzip files from the versioned dictionary URL', async () => {
    fetcher.mockImplementation(async () =>
      ok(gzipSync(new Uint8Array([1, 2, 3]))),
    )
    await load(['日本'], 'ja-JP')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/dict/kuromoji-test/base.dat.gz',
      '/dict/kuromoji-test/cc.dat.gz',
    ])
    expect(bytes()).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ])
  })

  it('accepts files a server already decompressed', async () => {
    await load(['日本'], 'ja-JP')
    expect(bytes()).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ])
  })

  it.each([
    ['SPA fallback HTML', () => ok('<html></html>', 'text/html')],
    ['an HTTP error', () => new Response('Missing', { status: 404 })],
  ])('rejects %s', async (_name, response) => {
    fetcher.mockImplementation(async () => response())
    await expect(load(['日本'], 'ja-JP')).rejects.toThrow(
      'Could not load the Japanese dictionary',
    )
  })

  it('shares one build between concurrent calls', async () => {
    await Promise.all([load(['日本'], 'ja-JP'), load(['語'], 'ja-JP')])
    expect(kuromoji.built).toBe(1)
    await load(['日本語'], 'ja-JP')
    expect(kuromoji.built).toBe(1)
  })

  it('builds again after a failed download', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(load(['日本'], 'ja-JP')).rejects.toThrow('Failed to fetch')
    await expect(load(['日本'], 'ja-JP')).resolves.toEqual([[{ base: '日本' }]])
    expect(kuromoji.built).toBe(2)
  })
})
