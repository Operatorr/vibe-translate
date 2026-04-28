import * as z from 'zod'

export const chatCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceLanguage: z.string().trim().min(1).max(80),
  targetLanguage: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(2000).optional(),
})

export const chatUpdateSchema = chatCreateSchema.partial().refine((value) => {
  return Object.keys(value).length > 0
}, 'At least one field is required')

export const translationCreateSchema = z.object({
  chatId: z.string().uuid(),
  sourceText: z.string().trim().min(1).max(20_000),
  translatedText: z.string().trim().min(1).max(20_000),
})

export const translationUpdateSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(20_000).optional(),
    translatedText: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  onboardingComplete: z.boolean().optional(),
  locale: z.string().trim().min(2).max(12).optional(),
})

export const waitlistSchema = z.object({
  email: z.string().trim().email(),
  source: z.string().trim().max(120).optional(),
})

export const checkoutSchema = z.object({
  plan: z.enum(['pro', 'team']),
})

export const textToSpeechSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  vibe: z.enum(['yakuza', 'friend', 'casual', 'keigo', 'keigoplus', 'emperor']),
  languageCode: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i)
    .transform((value) => value.toLowerCase())
    .optional(),
})
