import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  DEMO_TARGETS,
  demoAudioPath,
} from '../../components/vibe-design/landing-demo-data'
import type { DemoVibe } from '../../components/vibe-design/landing-demo-data'

type VoiceManifest = {
  model: string
  voices: Record<string, { id: string; accent?: string; language?: string }>
  recordings: Record<
    string,
    { voiceId: string; text: string; model: string; sha256: string }
  >
}
const manifest = JSON.parse(
  readFileSync(
    new URL('../../../public/demo/voices.json', import.meta.url),
    'utf8',
  ),
) as VoiceManifest & { languages: Record<string, VoiceManifest> }

it.each(DEMO_TARGETS)(
  'ships six matching, distinct recordings for $name',
  (target) => {
    const voices =
      target.id === 'ja-JP' ? manifest : manifest.languages[target.id]
    const voiceIds = new Set<string>()
    expect(Object.keys(target.translations)).toEqual(
      DEMO_TARGETS[0].vibes.map((vibe) => vibe.id),
    )
    expect(target.vibes.map((vibe) => vibe.id)).toEqual(
      Object.keys(target.translations),
    )
    for (const [vibe, text] of Object.entries(target.translations)) {
      const label = `${target.id}/${vibe}`
      const audio = readFileSync(
        new URL(
          `../../../public${demoAudioPath(target.id, vibe as DemoVibe)}`,
          import.meta.url,
        ),
      )
      expect(audio.length, label).toBeGreaterThan(1000)
      // Reject error JSON and SPA fallback HTML disguised as an audio file.
      const hasId3 = audio.subarray(0, 3).toString() === 'ID3'
      const hasMpegFrame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0
      expect(hasId3 || hasMpegFrame, label).toBe(true)
      const recording = voices.recordings[vibe]
      expect(recording.text, label).toBe(text)
      expect(recording.model, label).toBe(voices.model)
      expect(recording.voiceId, label).toBe(voices.voices[vibe].id)
      expect(recording.sha256, label).toBe(
        createHash('sha256').update(audio).digest('hex'),
      )
      if (target.id !== 'ja-JP') {
        expect(voices.voices[vibe].accent, label).toBe(target.accent)
        expect(voices.voices[vibe].language, label).toBe(target.speechLanguage)
      }
      voiceIds.add(recording.voiceId)
    }
    expect(voiceIds.size).toBe(6)
  },
)
