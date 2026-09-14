import { describe, expect, it } from 'vitest'

import { normalizeWord, srcWordSet } from '../alignment'

describe('hover-align word matching', () => {
  it('matches whole words only, never substrings', () => {
    const set = srcWordSet('recipe')
    expect(set.has(normalizeWord('recipe'))).toBe(true)
    expect(set.has(normalizeWord('I'))).toBe(false) // "recipe" contains "i"
    expect(srcWordSet('them').has(normalizeWord('the'))).toBe(false)
  })

  it('matches multi-word spans word by word, ignoring case and punctuation', () => {
    const set = srcWordSet("so I don't forget")
    expect(set.has(normalizeWord('Forget?'))).toBe(true)
    expect(set.has(normalizeWord("don't"))).toBe(true)
    expect(set.has(normalizeWord('so,'))).toBe(true)
  })

  it('never matches punctuation-only words', () => {
    expect(normalizeWord('—')).toBe('')
    expect(srcWordSet(', .').size).toBe(0)
  })
})
