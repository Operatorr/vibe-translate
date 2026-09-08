import type { VibeStop } from '@/lib/types'

// Text-to-speech with two engines:
//   - ElevenLabs (Pro+, Japanese only today) via POST /api/ai/text-to-speech,
//     one voice per Vibe stop. The caller decides eligibility from /api/users/me.
//   - Browser speech synthesis (free tier, every other language, and any
//     ElevenLabs failure). No network, no credits.
// Only one utterance plays at a time; calling `speak` again stops the last one.

export type SpeakEngine = 'elevenlabs' | 'browser'

export type SpeakRequest = {
  text: string
  languageCode: string
  vibe: VibeStop
  // When provided and returns a Blob, the ElevenLabs path is attempted first.
  fetchAudio?: (input: { text: string; vibe: VibeStop; languageCode: string }) => Promise<Blob>
  onStart?: (engine: SpeakEngine) => void
  onEnd?: () => void
}

let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export function browserTtsSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

// Pick the best available system voice for a BCP-47 code: exact match first,
// then same language, then whatever the browser defaults to.
function pickVoice(languageCode: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const want = languageCode.toLowerCase()
  const lang = want.split('-')[0]
  return (
    voices.find((v) => v.lang.toLowerCase() === want) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ??
    null
  )
}

// Vibe → prosody for the browser engine so the six stops still sound
// different without a dedicated voice.
const BROWSER_PROSODY: Record<VibeStop, { rate: number; pitch: number }> = {
  yakuza: { rate: 0.95, pitch: 0.7 },
  friend: { rate: 1.1, pitch: 1.1 },
  casual: { rate: 1.0, pitch: 1.0 },
  keigo: { rate: 0.95, pitch: 1.0 },
  keigoplus: { rate: 0.9, pitch: 0.95 },
  emperor: { rate: 0.8, pitch: 0.8 },
}

function speakWithBrowser(req: SpeakRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!browserTtsSupported()) {
      reject(new Error('Speech synthesis is not supported in this browser'))
      return
    }
    const run = () => {
      const utterance = new SpeechSynthesisUtterance(req.text)
      utterance.lang = req.languageCode
      const voice = pickVoice(req.languageCode)
      if (voice) utterance.voice = voice
      const prosody = BROWSER_PROSODY[req.vibe]
      utterance.rate = prosody.rate
      utterance.pitch = prosody.pitch
      utterance.onstart = () => req.onStart?.('browser')
      utterance.onend = () => {
        req.onEnd?.()
        resolve()
      }
      utterance.onerror = (event) => {
        req.onEnd?.()
        if (event.error === 'interrupted' || event.error === 'canceled') resolve()
        else reject(new Error(`Speech synthesis failed (${event.error})`))
      }
      speechSynthesis.speak(utterance)
    }
    // Chrome populates voices asynchronously on first use.
    if (speechSynthesis.getVoices().length === 0) {
      let done = false
      const handler = () => {
        if (done) return
        done = true
        speechSynthesis.removeEventListener('voiceschanged', handler)
        run()
      }
      speechSynthesis.addEventListener('voiceschanged', handler)
      setTimeout(handler, 300)
    } else {
      run()
    }
  })
}

async function speakWithElevenLabs(req: SpeakRequest): Promise<void> {
  if (!req.fetchAudio) throw new Error('No ElevenLabs fetcher')
  const blob = await req.fetchAudio({
    text: req.text,
    vibe: req.vibe,
    languageCode: req.languageCode,
  })
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    currentUrl = url
    const cleanup = () => {
      if (currentAudio === audio) {
        currentAudio = null
        currentUrl = null
      }
      URL.revokeObjectURL(url)
      req.onEnd?.()
    }
    audio.onplay = () => req.onStart?.('elevenlabs')
    audio.onended = () => {
      cleanup()
      resolve()
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('Audio playback failed'))
    }
    audio.play().catch((error) => {
      cleanup()
      reject(error instanceof Error ? error : new Error('Audio playback failed'))
    })
  })
}

// Speak `text`, preferring ElevenLabs when a fetcher is supplied and falling
// back to the browser engine on any failure. Resolves with the engine used.
export async function speak(req: SpeakRequest): Promise<SpeakEngine> {
  stopSpeaking()
  if (req.fetchAudio) {
    try {
      await speakWithElevenLabs(req)
      return 'elevenlabs'
    } catch {
      // fall through to the browser engine
    }
  }
  await speakWithBrowser(req)
  return 'browser'
}
