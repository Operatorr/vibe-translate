import * as z from 'zod'

// Canonical 6-stop Vibe slider. Identical IDs across all target languages.
// Per-language labels/hints are owned by the frontend Vibe preset table.
export const VIBE_STOPS = [
  'yakuza',
  'friend',
  'casual',
  'keigo',
  'keigoplus',
  'emperor',
] as const

export const vibeStopSchema = z.enum(VIBE_STOPS)

// Persona block that shapes a Character's translation prompt.
export const personaSchema = z
  .object({
    age: z.string().trim().max(60).optional(),
    region: z.string().trim().max(120).optional(),
    formality: z.string().trim().max(120).optional(),
    traits: z.array(z.string().trim().max(120)).max(20).default([]),
  })
  .strict()

const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i, 'Use a BCP-47 code, e.g. ja-JP')

export const characterCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  initials: z.string().trim().max(4).optional(),
  color: z.string().trim().max(40).optional(),
  sourceLanguage: localeSchema,
  targetLanguage: localeSchema,
  defaultVibe: vibeStopSchema.default('casual'),
  temperature: z.number().min(0).max(1).default(0.4),
  persona: personaSchema.default({ traits: [] }),
  // Free-form system-prompt extension. Appended to the translate prompt.
  instructions: z.string().trim().max(2000).optional(),
})

// Onboarding dictation: free-form prompt → Character draft. Free, one-shot,
// rate-limited, requires onboarding_complete = false. See docs/PRODUCT.md.
export const onboardingDictateSchema = z.object({
  prompt: z.string().trim().min(3).max(1000),
})

// The Character draft returned by dictation parsing. All fields optional —
// the client pre-fills the confirmation form with whatever was extracted.
export const characterDraftSchema = z.object({
  ok: z.boolean(),
  name: z.string().trim().max(80).optional(),
  sourceLanguage: localeSchema.optional(),
  targetLanguage: localeSchema.optional(),
  defaultVibe: vibeStopSchema.optional(),
  temperature: z.number().min(0).max(1).optional(),
  persona: personaSchema.optional(),
  instructions: z.string().trim().max(2000).optional(),
})

export const characterUpdateSchema = characterCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const characterReorderSchema = z.object({
  characterIds: z.array(z.string().uuid()).min(1).max(500),
})

export const threadCreateSchema = z.object({
  characterId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
})

export const threadUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

// A single token in the word-alignment map for a Segment's target text.
// `t` is the target token; `src` is the matching span on the source side
// (empty string when the token has no source counterpart, e.g. punctuation).
export const segmentTokenSchema = z
  .object({
    t: z.string(),
    src: z.string(),
  })
  .strict()

// Client posts only the input. `targetText` and `tokenAlignment` are
// produced server-side by calling the translation provider; clients cannot
// supply them directly. Omitting `vibe` means "inherit characters.default_vibe".
export const segmentCreateSchema = z.object({
  threadId: z.string().uuid(),
  sourceText: z.string().trim().min(1).max(20_000),
  vibe: vibeStopSchema.optional(),
})

// PATCH allows manual edits to history (a learner tweaking a stored
// translation). The server still re-validates structure and bounds.
export const segmentUpdateSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(20_000).optional(),
    targetText: z.string().trim().min(1).max(20_000).optional(),
    vibe: vibeStopSchema.optional(),
    tokenAlignment: z.array(segmentTokenSchema).max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

// Translation Memory search. `q` is embedded server-side; the worker returns
// top-K matching past Segments scoped to the user. See docs/API.md.
export const memorySearchSchema = z.object({
  q: z.string().trim().min(1).max(2000),
  characterId: z.string().uuid().optional(),
  targetLanguage: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  onboardingComplete: z.boolean().optional(),
  locale: z.string().trim().min(2).max(12).optional(),
})

// BYOK: stores the user's OpenRouter API key. Plaintext over TLS only;
// persisted as AES-GCM ciphertext (see api/_lib/secrets.ts).
// The key never appears in any GET response — only `last4` is returned.
export const byokSetSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^sk-[A-Za-z0-9-_]+$/i, 'OpenRouter keys start with "sk-"'),
})

// Optional per-task BYOK model overrides. Empty string clears.
export const byokModelsSchema = z
  .object({
    translateModelId: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/i, 'Use provider/model format')
      .nullable()
      .optional(),
    explainModelId: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/i, 'Use provider/model format')
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const waitlistSchema = z.object({
  email: z.string().trim().email(),
  source: z.string().trim().max(120).optional(),
})

export const checkoutSchema = z.object({
  plan: z.enum(['pro', 'team']),
})

export const textToSpeechSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  vibe: vibeStopSchema,
  languageCode: localeSchema
    .transform((value) => value.toLowerCase())
    .optional(),
})

export type VibeStop = z.infer<typeof vibeStopSchema>
export type Persona = z.infer<typeof personaSchema>
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>
export type CharacterDraft = z.infer<typeof characterDraftSchema>
export type ThreadCreateInput = z.infer<typeof threadCreateSchema>
export type SegmentCreateInput = z.infer<typeof segmentCreateSchema>
export type SegmentToken = z.infer<typeof segmentTokenSchema>
