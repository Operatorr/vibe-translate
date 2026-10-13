// Reading aids drawn above a Target segment: Pinyin over Chinese characters,
// Kana (furigana) over Japanese kanji. Generated entirely in the browser from
// lazily loaded libraries, so they cost no credits and work on every Segment.
// The Japanese dictionary (~17 MB gzipped) is served from /dict/ and kept in
// its own service-worker cache after the first use; see docs/FRONTEND.md.

export type ReadingScript = 'pinyin' | 'kana'

// One run of target text. `rt` is the reading drawn above it; runs without a
// reading (kana, punctuation, Latin) render as plain text.
export type RubyPart = { base: string; rt?: string }

export function readingScriptFor(language: string): ReadingScript | null {
  if (/^zh([-_]|$)/i.test(language)) return 'pinyin'
  if (/^ja([-_]|$)/i.test(language)) return 'kana'
  return null
}

export const READING_LABEL: Record<ReadingScript, string> = {
  pinyin: 'Pinyin',
  kana: 'Kana',
}

// Readings for each alignment token, in token order. Each token's parts
// concatenate back to that token exactly.
export async function loadReadings(
  tokens: string[],
  language: string,
): Promise<RubyPart[][]> {
  const script = readingScriptFor(language)
  if (script === 'pinyin') return pinyinReadings(tokens, language)
  if (script === 'kana') return kanaReadings(tokens)
  return tokens.map((t) => [{ base: t }])
}

// ---------------------------------------------------------------------------
// Chinese

type PinyinItem = { origin: string; pinyin: string; isZh: boolean }

async function pinyinReadings(
  tokens: string[],
  language: string,
): Promise<RubyPart[][]> {
  const [{ pinyin }, OpenCC] = await Promise.all([
    import('pinyin-pro'),
    import('opencc-js/t2cn'),
  ])
  const text = tokens.join('')
  // pinyin-pro's polyphone data is keyed on Simplified characters (車 reads
  // jū, 车 reads chē), so convert first. Conversion is per character here;
  // keep the original if a phrase rule ever changes the length.
  const from = /-(hk|mo)$/i.test(language) ? 'hk' : 'tw'
  const simplified = OpenCC.Converter({ from, to: 'cn' })(text)
  const source =
    Array.from(simplified).length === Array.from(text).length
      ? simplified
      : text
  const items: PinyinItem[] = pinyin(source, { type: 'all' })
  return splitByTokens(tokens, perCharPinyin(items))
}

// Flatten pinyin-pro output to one reading (or none) per code point.
export function perCharPinyin(items: PinyinItem[]): (string | undefined)[] {
  const out: (string | undefined)[] = []
  for (const item of items) {
    const chars = Array.from(item.origin)
    const reading = item.isZh && chars.length === 1 ? item.pinyin : undefined
    for (let i = 0; i < chars.length; i++) out.push(reading || undefined)
  }
  return out
}

// Slice per-code-point readings back onto the alignment tokens, merging
// consecutive unread characters into one plain run.
export function splitByTokens(
  tokens: string[],
  readings: (string | undefined)[],
): RubyPart[][] {
  let cursor = 0
  return tokens.map((token) => {
    const parts: RubyPart[] = []
    for (const ch of Array.from(token)) {
      const rt = readings[cursor++]
      const last = parts[parts.length - 1]
      if (rt) parts.push({ base: ch, rt })
      else if (last && !last.rt) last.base += ch
      else parts.push({ base: ch })
    }
    return parts
  })
}

// ---------------------------------------------------------------------------
// Japanese

type KanaTokenizer = {
  tokenize(text: string): { surface_form: string; reading?: string }[]
}

let tokenizerPromise: Promise<KanaTokenizer> | null = null

function kanaTokenizer(): Promise<KanaTokenizer> {
  tokenizerPromise ??= (async () => {
    const kuromoji = await import('@patdx/kuromoji')
    return new kuromoji.TokenizerBuilder({
      loader: { loadArrayBuffer: loadDictFile },
    }).build()
  })()
  // A failed download (offline, flaky network) may be retried on next tap.
  tokenizerPromise.catch(() => {
    tokenizerPromise = null
  })
  return tokenizerPromise
}

async function loadDictFile(file: string): Promise<ArrayBuffer> {
  const res = await fetch(__KUROMOJI_DICT_URL__ + file)
  // The SPA fallback answers unknown paths with index.html and a 200.
  if (!res.ok || res.headers.get('Content-Type')?.includes('text/html')) {
    throw new Error(`Could not load the Japanese dictionary (${file})`)
  }
  const bytes = await res.arrayBuffer()
  // Files ship gzipped; a server that adds Content-Encoding has already
  // inflated them, so only decompress when the gzip magic is still there.
  const head = new Uint8Array(bytes, 0, 2)
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

async function kanaReadings(tokens: string[]): Promise<RubyPart[][]> {
  const tokenizer = await kanaTokenizer()
  // Analysed per alignment token so a reading never straddles two tokens.
  return tokens.map((token) =>
    mergePlain(
      tokenizer
        .tokenize(token)
        .flatMap((m) => furigana(m.surface_form, m.reading)),
    ),
  )
}

const KANJI = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2fa1f}々〆ヵヶ]/u

export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}

// Place a morpheme's reading over its kanji only, leaving okurigana bare:
// 書い + カイ → 書(か)い. Falls back to one reading over the whole surface
// when the kana around the kanji don't line up with the reading.
export function furigana(surface: string, reading?: string): RubyPart[] {
  if (!KANJI.test(surface) || !reading || reading === '*') {
    return [{ base: surface }]
  }
  const kana = toHiragana(reading)
  const runs: { text: string; kanji: boolean }[] = []
  for (const ch of Array.from(surface)) {
    const kanji = KANJI.test(ch)
    const last = runs[runs.length - 1]
    if (last && last.kanji === kanji) last.text += ch
    else runs.push({ text: ch, kanji })
  }
  const pattern = runs
    .map((run) =>
      run.kanji
        ? '(.+?)'
        : toHiragana(run.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  const match = new RegExp(`^${pattern}$`, 'u').exec(kana)
  if (!match) return [{ base: surface, rt: kana }]
  let group = 1
  return runs.map((run) =>
    run.kanji ? { base: run.text, rt: match[group++] } : { base: run.text },
  )
}

function mergePlain(parts: RubyPart[]): RubyPart[] {
  const out: RubyPart[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (!part.rt && last && !last.rt) last.base += part.base
    else out.push({ ...part })
  }
  return out
}
