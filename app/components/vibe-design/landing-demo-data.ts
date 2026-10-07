import { DEMO_PAIRS_JA, VIBE_PRESETS_PER_LANG } from './design-data.ts'
import type { VibePreset } from './design-data.ts'

export const DEMO_SOURCE = "Stop talking and follow me. You won't regret it."
export type DemoVibe = keyof typeof DEMO_PAIRS_JA
export type DemoLanguage = 'ja-JP' | 'zh-CN' | 'zh-TW' | 'th-TH'

type DemoTarget = {
  id: DemoLanguage
  name: string
  nativeName: string
  flag: string
  speechLanguage: string
  accent: string
  vibes: VibePreset[]
  translations: Record<DemoVibe, string>
}

// These are register equivalents, not a claim that every language has keigo.
// The ceremonial stop speaks as a ruler; it does not address a royal listener.
export const DEMO_TARGETS: DemoTarget[] = [
  {
    id: 'ja-JP',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    speechLanguage: 'ja',
    accent: 'standard',
    vibes: VIBE_PRESETS_PER_LANG['ja-JP'],
    translations: DEMO_PAIRS_JA,
  },
  {
    id: 'zh-CN',
    name: 'Chinese',
    nativeName: '普通话',
    flag: '🇨🇳',
    speechLanguage: 'zh',
    accent: 'beijing mandarin',
    vibes: VIBE_PRESETS_PER_LANG['zh-CN'],
    translations: {
      yakuza: '闭嘴，跟老子走。保你不后悔。',
      friend: '别说啦，跟我来吧。保证你不会后悔！',
      casual: '先别说话，跟我来。你不会后悔的。',
      keigo: '请您先别说话，跟我来。我保证您不会后悔。',
      keigoplus: '劳驾您暂且停止交谈，随我前来。我向您保证，您不会为此后悔。',
      emperor: '噤声，随朕前来。朕保你无悔。',
    },
  },
  {
    id: 'zh-TW',
    name: 'Taiwanese Mandarin',
    nativeName: '國語',
    flag: '🇹🇼',
    speechLanguage: 'zh',
    accent: 'taiwan mandarin',
    vibes: [
      {
        id: 'yakuza',
        label: '粗話',
        hint: 'rough · 老子',
        color: 'var(--red-400)',
      },
      {
        id: 'friend',
        label: '朋友',
        hint: 'friends · 啦 / 喔',
        color: 'var(--orange-400)',
      },
      {
        id: 'casual',
        label: '日常',
        hint: 'everyday · 你',
        color: 'var(--amber-400)',
      },
      {
        id: 'keigo',
        label: '禮貌',
        hint: 'polite · 請 / 您',
        color: 'var(--turq-400)',
      },
      {
        id: 'keigoplus',
        label: '正式',
        hint: 'formal · 敬請',
        color: 'var(--cyan-400)',
      },
      {
        id: 'emperor',
        label: '皇室',
        hint: 'imperial · 朕',
        color: 'var(--magenta-400)',
      },
    ],
    translations: {
      yakuza: '閉嘴，跟老子走。保證你不會後悔。',
      friend: '別講啦，跟我來嘛。保證你不會後悔喔！',
      casual: '先別說話，跟我來。你不會後悔的。',
      keigo: '請您先別說話，跟我來。我保證您不會後悔。',
      keigoplus:
        '不好意思，敬請您暫停交談，隨我前來。我向您保證，您不會因此後悔。',
      emperor: '噤聲，隨朕前來。朕保你無悔。',
    },
  },
  {
    id: 'th-TH',
    name: 'Thai',
    nativeName: 'ไทย',
    flag: '🇹🇭',
    speechLanguage: 'th',
    accent: 'standard',
    vibes: [
      {
        id: 'yakuza',
        label: 'หยาบ',
        hint: 'rough · กู / มึง',
        color: 'var(--red-400)',
      },
      {
        id: 'friend',
        label: 'เพื่อน',
        hint: 'friends · เรา / เธอ',
        color: 'var(--orange-400)',
      },
      {
        id: 'casual',
        label: 'ทั่วไป',
        hint: 'everyday · ฉัน / คุณ',
        color: 'var(--amber-400)',
      },
      {
        id: 'keigo',
        label: 'สุภาพ',
        hint: 'polite · ผม / ครับ',
        color: 'var(--turq-400)',
      },
      {
        id: 'keigoplus',
        label: 'ทางการ',
        hint: 'formal · ดิฉัน / ท่าน',
        color: 'var(--cyan-400)',
      },
      {
        id: 'emperor',
        label: 'ราชสำนัก',
        hint: 'royal decree · เรา / เจ้า',
        color: 'var(--magenta-400)',
      },
    ],
    translations: {
      yakuza: 'หุบปากแล้วตามกูมา มึงจะไม่เสียใจทีหลัง',
      friend: 'หยุดพูดแล้วตามเรามานะ เธอจะไม่เสียใจแน่นอน!',
      casual: 'หยุดพูดแล้วตามฉันมา คุณจะไม่เสียใจทีหลัง',
      keigo: 'กรุณาหยุดพูดแล้วตามผมมาครับ ผมรับรองว่าคุณจะไม่เสียใจภายหลังครับ',
      keigoplus:
        'ขอความกรุณางดพูดสักครู่และตามดิฉันมาค่ะ ดิฉันขอรับรองว่าท่านจะไม่รู้สึกเสียใจในภายหลังค่ะ',
      emperor: 'จงหยุดพูดแล้วตามเรามา เราจะไม่ทำให้เจ้าต้องเสียใจภายหลัง',
    },
  },
]

export function demoAudioPath(language: DemoLanguage, vibe: DemoVibe) {
  return language === 'ja-JP'
    ? `/demo/vibe-${vibe}.mp3`
    : `/demo/${language}/vibe-${vibe}.mp3`
}
