// Thin wrapper over the (prefixed) Web Speech API for dictating into the
// composer. Chrome/Edge/Safari expose `webkitSpeechRecognition`; Firefox has
// nothing, in which case `createRecognizer` returns null and the UI explains.

type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>

type RecognitionEvent = { resultIndex: number; results: RecognitionResultList }

type RecognitionCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechRecognitionSupported(): boolean {
  return getCtor() !== null
}

export type Recognizer = {
  start(): void
  stop(): void
}

// Streams interim text into `onInterim` and appends finalized phrases via
// `onFinal`. `onEnd` fires when the engine stops for any reason.
export function createRecognizer(opts: {
  languageCode: string
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onEnd: () => void
  onError: (message: string) => void
}): Recognizer | null {
  const Ctor = getCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = opts.languageCode
  rec.continuous = true
  rec.interimResults = true
  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) opts.onFinal(transcript)
      else interim += transcript
    }
    opts.onInterim(interim)
  }
  rec.onend = () => opts.onEnd()
  rec.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return
    opts.onError(
      event.error === 'not-allowed'
        ? 'Microphone access was blocked. Allow it in your browser settings.'
        : `Dictation failed (${event.error})`,
    )
  }
  return {
    start: () => rec.start(),
    stop: () => rec.stop(),
  }
}
