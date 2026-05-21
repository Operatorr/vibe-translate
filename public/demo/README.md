# Landing demo audio samples

The landing page demo (`app/components/vibe-design/vibe-pages.tsx`) plays
**pre-rendered** per-vibe MP3s from this folder instead of calling the live
`/api/ai/text-to-speech` endpoint (which is authenticated and metered — see
`docs/SECURITY.md`).

## Required files

Six clips, one per Vibe stop. The component loads `/demo/vibe-<id>.mp3`:

| file | vibe | demo text (fixed, from `DEMO_PAIRS_JA`) |
| --- | --- | --- |
| `vibe-yakuza.mp3` | yakuza | 黙って俺について来い。後悔はさせねぇ。 |
| `vibe-friend.mp3` | friend | 黙ってついてきてよ。後悔はさせないから！ |
| `vibe-casual.mp3` | casual | 黙ってついてきてください。後悔はさせません。 |
| `vibe-keigo.mp3` | keigo | お黙りになって、私についてきてください。ご後悔はさせません。 |
| `vibe-keigoplus.mp3` | keigoplus | 恐れ入りますが、お言葉を控えていただき、私の後をご一緒くださいませ。ご後悔はさせません。 |
| `vibe-emperor.mp3` | emperor | 言の葉を慎みて、朕に従ひ来たれ。後の悔ゆることなからしめむ。 |

## How to generate

Each clip should use that vibe's **dedicated ElevenLabs voice** — the same
`ELEVENLABS_VOICE_<STOP>` voice the live endpoint uses for that register, so the
demo previews the real product. Generate with the same model as production
(`eleven_multilingual_v2`, `language_code: ja`, `apply_language_text_normalization: true`).

The texts above are the fixed demo translations; the source sentence is not
user-editable on the demo page. Drop the six MP3s here and the demo wires up
automatically. (A helper script that lists Japanese ElevenLabs voices and
renders these six clips can be added under a `scripts/` directory.)
