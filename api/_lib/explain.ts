import type { Persona } from './schemas'

// Bump when the Explain payload shape changes. Cached rows below this version
// are re-generated on demand. See docs/adr/0002.
export const EXPLAIN_PAYLOAD_VERSION = 1

export type ExplainGenerateInput = {
  sourceText: string
  sourceLanguage: string
  targetText: string
  targetLanguage: string
  persona: Persona
}

export type ExplainPayload = {
  version: number
  body: Record<string, unknown>
  tokenUsage: {
    modelId: string
    promptTokens: number
    completionTokens: number
  }
}

// Language-aware Explain generation. The payload shape varies per
// `targetLanguage` (Japanese gets kanji + JLPT + grammar patterns; other
// languages get their own scaffolding). Real model wiring lands in a follow-up.
export async function generateExplain(
  _input: ExplainGenerateInput,
): Promise<ExplainPayload> {
  throw new Error('Explain provider is not implemented yet')
}
