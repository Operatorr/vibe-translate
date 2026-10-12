import { describe, expect, it } from 'vitest'

import { sessionTranscript } from '../speech-recognition'

const results = (...transcripts: string[]) =>
  transcripts.map((transcript) =>
    Object.assign([{ transcript }], { isFinal: true }),
  )

describe('sessionTranscript', () => {
  it('joins separate phrases (desktop Chrome)', () => {
    expect(sessionTranscript(results('when will', ' the train arrive'))).toBe(
      'when will the train arrive',
    )
  })

  it('collapses cumulative results (Android Chrome)', () => {
    expect(
      sessionTranscript(
        results(
          'When',
          'When will',
          'when will the',
          'when will the train',
          'when will the train arrive',
        ),
      ),
    ).toBe('when will the train arrive')
  })

  it('skips empty results', () => {
    expect(sessionTranscript(results('', 'hello', ' '))).toBe('hello')
  })
})
