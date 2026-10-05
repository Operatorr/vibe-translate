// Word matching for hover-align (app/components/app/segment-card.tsx). Kept
// pure so it can be unit-tested.

// Normalize one whitespace-delimited word: lowercase, punctuation stripped, so
// punctuation-only words never match anything.
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

// The set of normalized words in a token's `src` span. Matching against it is
// exact per word — "I" must not light up because "recipe" contains an "i".
export function srcWordSet(src: string): Set<string> {
  return new Set(src.split(/\s+/).map(normalizeWord).filter(Boolean))
}
