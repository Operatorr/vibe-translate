import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DEMO_PAIRS_JA } from '../app/components/vibe-design/design-data.ts'

// Node 22+: keep credentials in the ignored local env file, never in assets.
const envFile = fileURLToPath(new URL('../.dev.vars', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)
const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
if (!apiKey)
  throw new Error('Set ELEVENLABS_API_KEY in .dev.vars or the environment.')

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.elevenlabs.io/v1/${path}`, {
    ...init,
    headers: { 'xi-api-key': apiKey!, ...init?.headers },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok)
    throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`)
  return response
}

if (process.argv.includes('--list-voices')) {
  const response = await request('shared-voices?language=ja&page_size=100')
  const data = (await response.json()) as {
    voices: {
      voice_id: string
      name: string
      gender: string
      description: string
    }[]
  }
  console.table(
    data.voices.map(({ voice_id, name, gender, description }) => ({
      voice_id,
      name,
      gender,
      description,
    })),
  )
} else {
  const manifestUrl = new URL('../public/demo/voices.json', import.meta.url)
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as {
    model: string
    voices: Record<string, { id: string; name: string }>
    recordings?: Record<
      string,
      { voiceId: string; text: string; model: string; sha256: string }
    >
  }
  const entries = Object.entries(DEMO_PAIRS_JA).map(([vibe, text]) => {
    const configured =
      process.env[`ELEVENLABS_VOICE_${vibe.toUpperCase()}`]?.trim()
    const voice = manifest.voices[vibe]
    if (!voice) throw new Error(`Missing voice for ${vibe}`)
    return { vibe, text, voiceId: configured || voice.id }
  })
  if (new Set(entries.map(({ voiceId }) => voiceId)).size !== entries.length)
    throw new Error('The demo needs six distinct voice IDs.')

  for (const { vibe, text, voiceId } of entries) {
    const output = new URL(`../public/demo/vibe-${vibe}.mp3`, import.meta.url)
    const previous = manifest.recordings?.[vibe]
    if (
      existsSync(output) &&
      !process.argv.includes('--force') &&
      previous?.text === text &&
      previous.voiceId === voiceId &&
      previous.model === manifest.model &&
      previous.sha256 ===
        createHash('sha256')
          .update(await readFile(output))
          .digest('hex')
    ) {
      console.log(`Keeping ${vibe}; use --force to regenerate.`)
      continue
    }
    const response = await request(
      `text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: manifest.model,
          language_code: 'ja',
          apply_text_normalization: 'auto',
          ...(manifest.model === 'eleven_multilingual_v2'
            ? { apply_language_text_normalization: true }
            : {}),
        }),
      },
    )
    const audio = Buffer.from(await response.arrayBuffer())
    if (
      !response.headers.get('content-type')?.startsWith('audio/') ||
      audio.length < 1000
    )
      throw new Error(`Invalid audio response for ${vibe}`)
    await writeFile(output, audio)
    manifest.recordings ??= {}
    manifest.recordings[vibe] = {
      voiceId,
      text,
      model: manifest.model,
      sha256: createHash('sha256').update(audio).digest('hex'),
    }
    await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Generated ${vibe}: ${audio.length} bytes (${voiceId})`)
  }
}
