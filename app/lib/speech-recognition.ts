// Thin wrapper over the (prefixed) Web Speech API for dictating into the
// composer. Chrome/Edge/Safari expose `webkitSpeechRecognition`; Firefox has
// nothing, in which case `createRecognizer` returns null and the UI explains.

type RecognitionResultList = ArrayLike<
  ArrayLike<{ transcript: string }> & { isFinal: boolean }
>

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
  // Stop immediately and detach every handler, so a late result/end event can
  // never write into the composer after the caller has moved on.
  abort(): void
}

// Consecutive silent sessions tolerated before dictation gives up, so an
// abandoned mic doesn't stay hot forever.
const MAX_SILENT_RESTARTS = 2

// Streams interim text into `onInterim` and appends finalized phrases via
// `onFinal`. Chrome ends a `continuous` session after a pause, so the engine is
// restarted until the user stops, an error occurs, or it hears nothing for a
// few sessions in a row; `onEnd` fires once dictation is really over.
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
  let stopped = false
  let failed = false
  let silent = 0
  rec.onresult = (event) => {
    silent = 0
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) opts.onFinal(transcript)
      else interim += transcript
    }
    opts.onInterim(interim)
  }
  rec.onend = () => {
    if (!stopped && !failed && silent <= MAX_SILENT_RESTARTS) {
      try {
        rec.start()
        return
      } catch {
        // fall through and end
      }
    }
    opts.onEnd()
  }
  rec.onerror = (event) => {
    if (event.error === 'aborted') return
    if (event.error === 'no-speech') {
      silent += 1
      return
    }
    failed = true
    opts.onError(
      event.error === 'not-allowed'
        ? 'Microphone access was blocked. Allow it in your browser settings.'
        : `Dictation failed (${event.error})`,
    )
  }
  return {
    start: () => {
      stopped = false
      failed = false
      silent = 0
      rec.start()
    },
    stop: () => {
      stopped = true
      try {
        rec.stop()
      } catch {
        // already ended (e.g. after `not-allowed`)
      }
    },
    abort: () => {
      stopped = true
      rec.onresult = null
      rec.onend = null
      rec.onerror = null
      try {
        rec.abort()
      } catch {
        // already ended
      }
    },
  }
}
