import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { DEMO_PAIRS_JA } from '../../components/vibe-design/design-data'

it('ships an MP3 recording for every fixed landing demo translation', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../../public/demo/voices.json', import.meta.url),
      'utf8',
    ),
  ) as {
    model: string
    recordings: Record<
      string,
      { voiceId: string; text: string; model: string; sha256: string }
    >
  }
  const voiceIds = new Set<string>()
  for (const [vibe, text] of Object.entries(DEMO_PAIRS_JA)) {
    const audio = readFileSync(
      new URL(`../../../public/demo/vibe-${vibe}.mp3`, import.meta.url),
    )
    expect(audio.length, vibe).toBeGreaterThan(1000)
    // Reject error JSON and SPA fallback HTML disguised as an audio file.
    const hasId3 = audio.subarray(0, 3).toString() === 'ID3'
    const hasMpegFrame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0
    expect(hasId3 || hasMpegFrame, vibe).toBe(true)
    const recording = manifest.recordings[vibe]
    expect(recording.text, vibe).toBe(text)
    expect(recording.model, vibe).toBe(manifest.model)
    expect(recording.sha256, vibe).toBe(
      createHash('sha256').update(audio).digest('hex'),
    )
    voiceIds.add(recording.voiceId)
  }
  expect(voiceIds.size).toBe(6)
})
