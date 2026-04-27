export async function processDictationPrompt(prompt: string) {
  return {
    sourceLanguage: 'auto',
    targetLanguage: 'English',
    tone: 'natural',
    instructions: prompt,
  }
}
