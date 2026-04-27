import * as z from 'zod'

export const chatFormSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceLanguage: z.string().trim().min(1).max(80),
  targetLanguage: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(2000).optional(),
})

export type ChatFormInput = z.infer<typeof chatFormSchema>
