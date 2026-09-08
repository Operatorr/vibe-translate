import * as z from 'zod'

const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i, 'Use a BCP-47 code, e.g. ja-JP')

export const VIBE_STOPS = [
  'yakuza',
  'friend',
  'casual',
  'keigo',
  'keigoplus',
  'emperor',
] as const

export const vibeStopSchema = z.enum(VIBE_STOPS)

export const characterFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sourceLanguage: localeSchema,
  targetLanguage: localeSchema,
  defaultVibe: vibeStopSchema,
  temperature: z.number().min(0).max(1),
  persona: z
    .object({
      age: z.string().trim().max(60).optional(),
      region: z.string().trim().max(120).optional(),
      formality: z.string().trim().max(120).optional(),
      tone: z.string().trim().max(60).optional(),
      verbosity: z.number().min(0).max(1).optional(),
      traits: z.array(z.string().trim().max(120)).max(20).default([]),
    })
    .strict(),
  instructions: z.string().trim().max(2000).optional(),
})

export type CharacterFormInput = z.infer<typeof characterFormSchema>

export const threadFormSchema = z.object({
  characterId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
})

export type ThreadFormInput = z.infer<typeof threadFormSchema>
