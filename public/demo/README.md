# Landing demo audio

The landing demo plays 24 **prerecorded** MP3s directly from static assets.
Playback does not call the authenticated, metered `/api/ai/text-to-speech`
endpoint or ElevenLabs, so visitors cannot trigger new generation charges.

The fixed English source is “Stop talking and follow me. You won't regret it.”
[`landing-demo-data.ts`](../../app/components/vibe-design/landing-demo-data.ts)
contains the four targets and six register variants per target:

| Target             | Script              | Voice-library accent    | Files                   |
| ------------------ | ------------------- | ----------------------- | ----------------------- |
| Japanese           | Japanese            | Japanese                | `vibe-<stop>.mp3`       |
| Chinese            | Simplified Chinese  | `beijing mandarin`      | `zh-CN/vibe-<stop>.mp3` |
| Taiwanese Mandarin | Traditional Chinese | `taiwan mandarin`       | `zh-TW/vibe-<stop>.mp3` |
| Thai               | Thai                | Native Thai, `standard` | `th-TH/vibe-<stop>.mp3` |

Every target has six distinct voices. IDs, names, provider descriptions, and
accent metadata are saved in [`voices.json`](./voices.json). Delivery is matched
to the register: firm/rough, friendly, everyday, polite, formal, ceremonial.
The final stop speaks **as a ruler**; it does not address a royal listener.
Thai polite and formal translations use particles and pronouns appropriate
to their male and female voices, respectively. The six shared stop IDs remain
`yakuza`, `friend`, `casual`, `keigo`, `keigoplus`, and `emperor`.

## Generation

Requires Node 22.18+ and `ELEVENLABS_API_KEY` in the ignored `.dev.vars` file
or environment. Permissions: **Text to Speech: Access** and **Voices: Read**.
Generation consumes ElevenLabs credits; regular demo playback does not.

- `pnpm demo:audio`: generate missing or stale clips for all four targets.
- `pnpm demo:audio --language zh-TW`: generate only one target.
- `pnpm demo:audio --language th-TH --list-voices`: discover native voices.
- `pnpm demo:audio --language zh-CN --force`: regenerate a target's six clips.

The generator reads the displayed translations directly from the demo data
and uses standard `eleven_v4`, with `language_code` `ja`, `zh`, or `th`.
The live endpoint's `ELEVENLABS_MODEL_ID` is separate from this manifest.
Japanese overrides use `ELEVENLABS_VOICE_<STOP>`; other targets use
`ELEVENLABS_VOICE_ZH_CN_<STOP>`, `ELEVENLABS_VOICE_ZH_TW_<STOP>`, or
`ELEVENLABS_VOICE_TH_TH_<STOP>`. Overrides affect offline generation only.

Commit MP3s and the manifest alongside translation changes. `pnpm test`
verifies all 24 MP3 signatures, exact texts, voice IDs, accents, models, and
recording hashes. The generator skips only when all recorded fields and the
file hash match; interrupted runs can resume without regenerating saved clips.
