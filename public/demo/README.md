# Landing demo audio samples

The landing page demo (`app/components/vibe-design/vibe-pages.tsx`) plays
**pre-rendered** per-vibe MP3s from this folder instead of calling the live
`/api/ai/text-to-speech` endpoint (which is authenticated and metered — see
`docs/SECURITY.md`).

## Required files

Six clips, one per Vibe stop. The component loads `/demo/vibe-<id>.mp3`:

| file                 | vibe      | demo text (fixed, from `DEMO_PAIRS_JA`)                                                  |
| -------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `vibe-yakuza.mp3`    | yakuza    | 黙って俺について来い。後悔はさせねぇ。                                                   |
| `vibe-friend.mp3`    | friend    | 黙ってついてきてよ。後悔はさせないから！                                                 |
| `vibe-casual.mp3`    | casual    | 黙ってついてきてください。後悔はさせません。                                             |
| `vibe-keigo.mp3`     | keigo     | お黙りになって、私についてきてください。ご後悔はさせません。                             |
| `vibe-keigoplus.mp3` | keigoplus | 恐れ入りますが、お言葉を控えていただき、私の後をご一緒くださいませ。ご後悔はさせません。 |
| `vibe-emperor.mp3`   | emperor   | 言の葉を慎みて、朕に従ひ来たれ。後の悔ゆることなからしめむ。                             |

## How to generate

The six recordings use distinct Japanese voices from ElevenLabs. The voice
IDs and names are recorded in [`voices.json`](./voices.json):

| Vibe stop | Voice      | Delivery                         |
| --------- | ---------- | -------------------------------- |
| Yakuza    | PiropiroRX | Mature, husky character voice    |
| Friend    | Sey        | Bright, youthful conversation    |
| Casual    | Izu        | Natural, calm and friendly       |
| Keigo     | Rinko      | Clear, polite customer support   |
| Keigo+    | Kaori      | Composed, elegant female voice   |
| Emperor   | Ryu        | Deep, dramatic samurai character |

The fixed English source is “Stop talking and follow me. You won't regret it.”
It is read-only because this demo previews a fixed set of translations and
recordings; it does not generate new translations or audio at runtime.

To regenerate (Node 22.18+):

1. Set `ELEVENLABS_API_KEY` in the ignored `.dev.vars` file or your environment.
   The key needs **Text to Speech: Access** for generation and **Voices: Read**
   for discovery. No other permissions are required by this script.
2. Run `pnpm demo:audio --list-voices` to browse Japanese voices.
3. Run `pnpm demo:audio` to create missing clips, or `pnpm demo:audio --force`
   to regenerate all six. Generation uses ElevenLabs credits.

The generator reads the fixed texts directly from `DEMO_PAIRS_JA`. It uses
standard `eleven_v4` and `language_code: ja`. The older Japanese text
normalization flag is included only when generating with Multilingual v2;
v4 rejects it. The model is set in `voices.json`; the live endpoint's model
is separately configured via `ELEVENLABS_MODEL_ID`. Non-empty
`ELEVENLABS_VOICE_<STOP>` values override the checked-in voice IDs. Configure
the live endpoint with the same IDs when it should match the demo's voices.

Commit all six MP3s alongside any demo text changes. `pnpm test` checks that
every Vibe stop has a real MP3 asset rather than HTML or an error response,
that its recorded text matches the displayed translation, and that the six
recordings use distinct voice IDs. Recording hashes detect swapped assets.
