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

// Rebuild one session's transcript from its full result list. Desktop Chrome
// splits a session into separate phrases ("when will" + "the train arrive"),
// while Android Chrome reports cumulative ones ("when", "when will", "when will
// the", … often each marked final), so a result that repeats everything heard
// so far replaces it instead of being appended.
export function sessionTranscript(results: RecognitionResultList): string {
  let text = ''
  for (let i = 0; i < results.length; i += 1) {
    const next = (results[i]?.[0]?.transcript ?? '').trim()
    if (!next) continue
    if (next.toLowerCase().startsWith(text.toLowerCase())) text = next
    else text = `${text} ${next}`
  }
  return text
}

// Streams the current session's transcript into `onInterim` and commits it
// via `onFinal` when the session ends. Chrome ends a `continuous` session after
// a pause, so the engine is restarted until the user stops, an error occurs, or
// it hears nothing for a few sessions in a row; `onEnd` fires once dictation is
// really over.
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
  let heard = ''
  // Results only accumulate within a session, so the transcript is rebuilt
  // from all of them rather than from `resultIndex` onward (Android's
  // `resultIndex` and `isFinal` don't mean what desktop Chrome's do).
  rec.onresult = (event) => {
    silent = 0
    heard = sessionTranscript(event.results)
    opts.onInterim(heard)
  }
  rec.onend = () => {
    if (heard) {
      opts.onFinal(heard)
      opts.onInterim('')
      heard = ''
    }
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
      heard = ''
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
