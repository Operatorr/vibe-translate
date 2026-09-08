// Rough token estimate for the composer counter: CJK ~1 token per character,
// everything else ~4 characters per token.
const CJK = /[\u3000-\u9fff\uac00-\ud7af]/

export function estimateTokens(text: string): number {
  let cjk = 0
  for (const ch of text) if (CJK.test(ch)) cjk += 1
  return Math.round(cjk + (text.length - cjk) / 4)
}
