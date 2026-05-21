import type { CharacterDraft, Persona, SegmentToken, VibeStop } from './schemas'

export type TranslationProviderResult = {
  targetText: string
  tokenAlignment: SegmentToken[]
  tokenUsage: {
    modelId: string
    promptTokens: number
    completionTokens: number
    costCents?: number
  }
}

export type TranslateSegmentInput = {
  sourceText: string
  sourceLanguage: string
  targetLanguage: string
  vibe: VibeStop
  temperature: number
  persona: Persona
  // Free-form system-prompt extension from the Character.
  instructions?: string
}

// Synchronous translate-and-return path. The worker calls OpenRouter, parses
// the response into `{ targetText, tokenAlignment, tokenUsage }`, and the
// route handler writes a Segment row. See docs/BACKEND.md and ADR 0001.
export async function translateSegment(
  _input: TranslateSegmentInput,
): Promise<TranslationProviderResult> {
  throw new Error('OpenRouter translation provider is not implemented yet')
}

// Onboarding dictation: parse a free-form description ("text my friend Tomoko
// in Tokyo casually in Japanese") into a Character draft. The client pre-fills
// the confirmation form with whatever was extracted. `ok: false` signals the
// parse failed and the UI should fall back to the empty form.
// Uses the `dictation` model registry task. See docs/PRODUCT.md.
export async function draftCharacterFromDictation(_prompt: string): Promise<CharacterDraft> {
  throw new Error('Dictation parsing is not implemented yet')
}
