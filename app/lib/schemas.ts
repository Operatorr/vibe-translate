import * as z from 'zod'
import { CHARACTER_LANGUAGES, SOURCE_LANGUAGES } from './character-options'

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
  sourceLanguage: z.enum(SOURCE_LANGUAGES, {
    error: 'Choose English or one of the four supported source languages',
  }),
  targetLanguage: z.enum(CHARACTER_LANGUAGES, {
    error: 'Choose Simplified Chinese, Traditional Chinese, Thai or Japanese',
  }),
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

// Public share payload (GET /api/share/:token). Parsed on the client because
// the page is reachable by anyone; a malformed alignment degrades to the
// whole-text fallback instead of crashing the view.
const segmentTokenSchema = z.object({
  t: z.string(),
  src: z.string().catch(''),
})

export const sharedThreadSchema = z.object({
  thread: z.object({
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  character: z.object({
    name: z.string(),
    initials: z.string().optional(),
    color: z.string().optional(),
    sourceLanguage: z.string(),
    targetLanguage: z.string(),
    defaultVibe: vibeStopSchema,
  }),
  segments: z.array(
    z.object({
      id: z.string(),
      sourceText: z.string(),
      targetText: z.string(),
      vibe: vibeStopSchema.nullable(),
      tokenAlignment: z.array(segmentTokenSchema).catch([]),
      createdAt: z.string(),
    }),
  ),
})
