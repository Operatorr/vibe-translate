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
  // `signal` aborts when the utterance is stopped or superseded.
  fetchAudio?: (
    input: { text: string; vibe: VibeStop; languageCode: string },
    options: { signal: AbortSignal },
  ) => Promise<Blob>
  onStart?: (engine: SpeakEngine) => void
  onEnd?: () => void
}

let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null
let currentAbort: AbortController | null = null
// Bumped by every stopSpeaking(). A speak() whose generation is stale must not
// start playback, fall back to the browser engine, or report onEnd — otherwise
// Stop (or speaking another segment) lets the old utterance resurface.
let generation = 0

export function stopSpeaking() {
  generation += 1
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
  }
  if (currentAudio) {
    const audio = currentAudio
    currentAudio = null
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.src = ''
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export function browserTtsSupported(): boolean {
  return (
    typeof speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

// Pick the best available system voice for a BCP-47 code: exact match first,
// then same language, then whatever the browser defaults to. Android reports
// voice langs with underscores (`ja_JP`), so both sides are normalized.
const normLang = (code: string) => code.toLowerCase().replace(/_/g, '-')

function pickVoice(languageCode: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const want = normLang(languageCode)
  const lang = want.split('-')[0]
  return (
    voices.find((v) => normLang(v.lang) === want) ??
    voices.find((v) => {
      const have = normLang(v.lang)
      return have === lang || have.startsWith(`${lang}-`)
    }) ??
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

function speakWithBrowser(req: SpeakRequest, gen: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!browserTtsSupported()) {
      reject(new Error('Speech synthesis is not supported in this browser'))
      return
    }
    const run = () => {
      if (gen !== generation) {
        resolve()
        return
      }
      const utterance = new SpeechSynthesisUtterance(req.text)
      utterance.lang = req.languageCode
      const voice = pickVoice(req.languageCode)
      if (voice) utterance.voice = voice
      const prosody = BROWSER_PROSODY[req.vibe]
      utterance.rate = prosody.rate
      utterance.pitch = prosody.pitch
      utterance.onstart = () => req.onStart?.('browser')
      utterance.onend = () => {
        if (gen === generation) req.onEnd?.()
        resolve()
      }
      utterance.onerror = (event) => {
        if (gen === generation) req.onEnd?.()
        if (
          event.error === 'interrupted' ||
          event.error === 'canceled' ||
          gen !== generation
        )
          resolve()
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

async function speakWithElevenLabs(
  req: SpeakRequest,
  gen: number,
  signal: AbortSignal,
): Promise<void> {
  if (!req.fetchAudio) throw new Error('No ElevenLabs fetcher')
  const blob = await req.fetchAudio(
    { text: req.text, vibe: req.vibe, languageCode: req.languageCode },
    { signal },
  )
  // Stopped or superseded while the audio was downloading: drop the blob.
  if (gen !== generation) return
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
    }
    audio.onplay = () => req.onStart?.('elevenlabs')
    audio.onended = () => {
      cleanup()
      if (gen === generation) req.onEnd?.()
      resolve()
    }
    audio.onerror = () => {
      cleanup()
      if (gen !== generation) resolve()
      else reject(new Error('Audio playback failed'))
    }
    audio.play().catch((error) => {
      cleanup()
      if (gen !== generation) resolve()
      else
        reject(
          error instanceof Error ? error : new Error('Audio playback failed'),
        )
    })
  })
}

// Speak `text`, preferring ElevenLabs when a fetcher is supplied and falling
// back to the browser engine on a genuine failure. Resolves with the engine
// used, or null when the utterance was stopped/superseded before it finished.
export async function speak(req: SpeakRequest): Promise<SpeakEngine | null> {
  stopSpeaking()
  const gen = generation
  if (req.fetchAudio) {
    const abort = new AbortController()
    currentAbort = abort
    try {
      await speakWithElevenLabs(req, gen, abort.signal)
      return gen === generation ? 'elevenlabs' : null
    } catch {
      // An intentional stop is not a failure — never fall back after it.
      if (gen !== generation) return null
    } finally {
      if (currentAbort === abort) currentAbort = null
    }
  }
  if (gen !== generation) return null
  await speakWithBrowser(req, gen)
  return gen === generation ? 'browser' : null
}
