import { describe, expect, it } from 'vitest'

import {
  furigana,
  loadReadings,
  readingScriptFor,
  splitByTokens,
  toHiragana,
} from '../readings'

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
