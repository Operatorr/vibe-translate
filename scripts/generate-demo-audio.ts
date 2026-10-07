import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  DEMO_TARGETS,
  demoAudioPath,
} from '../app/components/vibe-design/landing-demo-data.ts'
import type { DemoVibe } from '../app/components/vibe-design/landing-demo-data.ts'

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

const languageArg = process.argv.indexOf('--language')
const selectedLanguage =
  languageArg === -1 ? undefined : process.argv[languageArg + 1]
const targets = DEMO_TARGETS.filter(
  (target) => !selectedLanguage || target.id === selectedLanguage,
)
if (!targets.length || (languageArg !== -1 && !selectedLanguage))
  throw new Error('Use --language ja-JP, zh-CN, zh-TW, or th-TH.')

if (process.argv.includes('--list-voices')) {
  for (const target of targets) {
    const params = new URLSearchParams({
      language: target.speechLanguage,
      page_size: '100',
      accent: target.accent,
    })
    const response = await request(`shared-voices?${params}`)
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
  }
} else {
  const manifestUrl = new URL('../public/demo/voices.json', import.meta.url)
  type VoiceManifest = {
    model: string
    voices: Record<
      string,
      {
        id: string
        name: string
        accent?: string
        language?: string
        description?: string
      }
    >
    recordings?: Record<
      string,
      { voiceId: string; text: string; model: string; sha256: string }
    >
  }
  const manifest = JSON.parse(
    await readFile(manifestUrl, 'utf8'),
  ) as VoiceManifest & { languages: Record<string, VoiceManifest> }
  for (const target of targets) {
    const voiceManifest =
      target.id === 'ja-JP' ? manifest : manifest.languages[target.id]
    if (!voiceManifest)
      throw new Error(`Missing voice manifest for ${target.id}`)
    const entries = []
    let voicesChanged = false
    for (const [vibe, text] of Object.entries(target.translations)) {
      const prefix =
        target.id === 'ja-JP'
          ? ''
          : `${target.id.replace('-', '_').toUpperCase()}_`
      const configured =
        process.env[`ELEVENLABS_VOICE_${prefix}${vibe.toUpperCase()}`]?.trim()
      const voice = voiceManifest.voices[vibe]
      if (!voice) throw new Error(`Missing voice for ${vibe}`)
      const voiceId = configured || voice.id
      if (voiceId !== voice.id) {
        const details = (await (
          await request(`voices/${encodeURIComponent(voiceId)}`)
        ).json()) as {
          name: string
          description?: string
          labels?: { language?: string; accent?: string }
          verified_languages?: { language: string; accent: string }[]
        }
        const native =
          details.verified_languages?.find(
            (language) =>
              language.language === target.speechLanguage &&
              language.accent === target.accent,
          ) ?? details.labels
        if (
          target.id !== 'ja-JP' &&
          (native?.language !== target.speechLanguage ||
            native.accent !== target.accent)
        )
          throw new Error(
            `Voice override for ${target.id}/${vibe} must match ${target.accent}.`,
          )
        voiceManifest.voices[vibe] = {
          id: voiceId,
          name: details.name,
          ...(native?.language ? { language: native.language } : {}),
          ...(native?.accent ? { accent: native.accent } : {}),
          ...(details.description ? { description: details.description } : {}),
        }
        voicesChanged = true
      }
      entries.push({ vibe, text, voiceId })
    }
    if (new Set(entries.map(({ voiceId }) => voiceId)).size !== entries.length)
      throw new Error('The demo needs six distinct voice IDs.')
    if (voicesChanged)
      await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')

    for (const { vibe, text, voiceId } of entries) {
      const output = new URL(
        `../public${demoAudioPath(target.id, vibe as DemoVibe)}`,
        import.meta.url,
      )
      const previous = voiceManifest.recordings?.[vibe]
      if (
        existsSync(output) &&
        !process.argv.includes('--force') &&
        previous?.text === text &&
        previous.voiceId === voiceId &&
        previous.model === voiceManifest.model &&
        previous.sha256 ===
          createHash('sha256')
            .update(await readFile(output))
            .digest('hex')
      ) {
        console.log(`Keeping ${target.id}/${vibe}; use --force to regenerate.`)
        continue
      }
      const response = await request(
        `text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: voiceManifest.model,
            language_code: target.speechLanguage,
            apply_text_normalization: 'auto',
            ...(voiceManifest.model === 'eleven_multilingual_v2' &&
            target.speechLanguage === 'ja'
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
      await mkdir(new URL('.', output), { recursive: true })
      await writeFile(output, audio)
      voiceManifest.recordings ??= {}
      voiceManifest.recordings[vibe] = {
        voiceId,
        text,
        model: voiceManifest.model,
        sha256: createHash('sha256').update(audio).digest('hex'),
      }
      await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
      console.log(
        `Generated ${target.id}/${vibe}: ${audio.length} bytes (${voiceId})`,
      )
    }
  }
}
