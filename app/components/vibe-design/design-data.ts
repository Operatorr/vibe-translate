// One stop on the Vibe slider. `label` and `hint` are in the user's source
// language (English unless `getVibesForLang` localizes them), so the slider is
// readable before the user can read the target. `native` is the target
// language's own name for the register, shown beside the label in the header.
export type VibePreset = {
  id: string
  label: string
  native: string
  hint: string
  color: string
}

// Slider order. A third copy of the six-stop contract (DB enum, api/_lib/
// schemas.ts → VIBE_STOPS); app/lib/__tests__/vibe-presets.test.ts keeps them
// in lockstep. Kept import-free so scripts can load this file directly.
const VIBE_STOP_IDS = [
  'yakuza',
  'friend',
  'casual',
  'keigo',
  'keigoplus',
  'emperor',
] as const
type VibeStopId = (typeof VIBE_STOP_IDS)[number]

const VIBE_COLORS: Record<VibeStopId, string> = {
  yakuza: 'var(--red-400)',
  friend: 'var(--orange-400)',
  casual: 'var(--amber-400)',
  keigo: 'var(--turq-400)',
  keigoplus: 'var(--cyan-400)',
  emperor: 'var(--magenta-400)',
}

// [label, native, hint] per stop.
type StopText = readonly [label: string, native: string, hint: string]

export const vibePresets = (
  stops: Record<VibeStopId, StopText>,
): VibePreset[] =>
  VIBE_STOP_IDS.map((id) => {
    const [label, native, hint] = stops[id]
    return { id, label, native, hint, color: VIBE_COLORS[id] }
  })

// Shared sample data copied from the designer prototype. Labels and hints are
// English; `native` is the target-language term.
export const VIBE_PRESETS_PER_LANG = {
  'ja-JP': vibePresets({
    yakuza: ['Yakuza', 'ヤクザ言葉', 'rough · 俺・お前・なめんなよ'],
    friend: ['Friend', 'タメ口', 'casual · お疲れ・〜じゃん'],
    casual: ['Casual', 'です・ます', 'light politeness'],
    keigo: ['Keigo', '丁寧語', 'standard polite'],
    keigoplus: ['Keigo+', '尊敬語', 'honorifics, business'],
    emperor: ['Emperor', '宮中言葉', 'archaic, ceremonial'],
  }),
  'ko-KR': vibePresets({
    yakuza: ['Rough', '막말', 'rough · 야 · 너'],
    friend: ['Banmal', '반말', 'friends, family'],
    casual: ['Casual', '해요체', 'standard polite'],
    keigo: ['Jondaemal', '존댓말', 'formal'],
    keigoplus: ['Hapsyo', '합쇼체', 'business, broadcast'],
    emperor: ['Royal', '궁중어', 'archaic court speech'],
  }),
  'en-US': vibePresets({
    yakuza: ['Gritty', 'Gritty', 'street · cussing ok'],
    friend: ['Buddy', 'Buddy', 'slack · contractions'],
    casual: ['Casual', 'Casual', 'newsletter voice'],
    keigo: ['Polite', 'Polite', 'docs default'],
    keigoplus: ['Formal', 'Formal', 'press release · cover letter'],
    emperor: ['Lordly', 'Lordly', 'thy / thee · ceremonial'],
  }),
  'pt-BR': vibePresets({
    yakuza: ['Rough', 'Boca-suja', 'street · heavy slang'],
    friend: ['Buddy', 'Amigo', 'mano · cara · tipo'],
    casual: ['Casual', 'Casual', 'podcast voice'],
    keigo: ['Polite', 'Polido', 'você · polite address'],
    keigoplus: ['Formal', 'Formal', 'senhor · public office'],
    emperor: ['Courtly', 'Cortês', 'vossa mercê · archaic'],
  }),
  'fr-FR': vibePresets({
    yakuza: ['Slang', 'Argot', 'verlan · crude'],
    friend: ['Buddy', 'Pote', 'tu · familiar'],
    casual: ['Casual', 'Neutre', 'tu · neutral'],
    keigo: ['Polite', 'Vous', 'vouvoiement · professional'],
    keigoplus: ['Formal', 'Formel', 'monsieur · administrative'],
    emperor: ['Royal', 'Royal', 'précieux · academic'],
  }),
  'de-DE': vibePresets({
    yakuza: ['Rough', 'Derb', 'Berlin · coarse'],
    friend: ['Buddy', 'Du', 'duzen · mates'],
    casual: ['Casual', 'Locker', 'Du · neutral'],
    keigo: ['Polite', 'Sie', 'siezen · polite'],
    keigoplus: ['Formal', 'Förmlich', 'Herr/Frau · official'],
    emperor: ['Majesty', 'Majestät', 'courtly · historic'],
  }),
  'es-ES': vibePresets({
    yakuza: ['Rough', 'Tacos', 'street · vulgar'],
    friend: ['Buddy', 'Tío', 'tuteo · among friends'],
    casual: ['Casual', 'Neutro', 'tú · neutral'],
    keigo: ['Polite', 'Usted', 'courteous · professional'],
    keigoplus: ['Formal', 'Formal', 'Don · administrative'],
    emperor: ['Royal', 'Real', 'Su Majestad · archaic'],
  }),
  'zh-CN': vibePresets({
    yakuza: ['Rough', '糙话', 'street · rude'],
    friend: ['Friend', '朋友', 'buddies · easy chat'],
    casual: ['Casual', '日常', 'neutral everyday'],
    keigo: ['Polite', '礼貌', '您 · business'],
    keigoplus: ['Formal', '正式', 'deferential · official'],
    emperor: ['Royal', '皇室', '朕 · archaic'],
  }),
  'zh-TW': vibePresets({
    yakuza: ['Rough', '粗話', 'street · rude'],
    friend: ['Friend', '朋友', 'familiar · easy chat'],
    casual: ['Casual', '日常', 'natural · everyday'],
    keigo: ['Polite', '禮貌', '您 · respectful'],
    keigoplus: ['Formal', '正式', 'honorifics · business'],
    emperor: ['Royal', '皇室', '朕 · archaic'],
  }),
  'th-TH': vibePresets({
    yakuza: ['Rough', 'หยาบ', 'blunt street language'],
    friend: ['Friend', 'เพื่อน', 'familiar language'],
    casual: ['Casual', 'ทั่วไป', 'everyday · conversational'],
    keigo: ['Polite', 'สุภาพ', 'respectful language'],
    keigoplus: ['Formal', 'ทางการ', 'business language'],
    emperor: ['Royal', 'ราชาศัพท์', 'royal · ceremonial'],
  }),
}

// Default fallback
export const VIBE_PRESETS_DEFAULT = VIBE_PRESETS_PER_LANG['en-US']

// [label, hint] per stop for non-English source languages. Generic across
// targets: the target-specific nuance lives in `native`.
const SOURCE_LABELS: Record<
  string,
  Record<VibeStopId, readonly [label: string, hint: string]>
> = {
  'ja-JP': {
    yakuza: ['乱暴', '荒っぽい言葉づかい'],
    friend: ['友達', 'くだけた口調'],
    casual: ['普通', '日常会話'],
    keigo: ['丁寧', '丁寧な言葉づかい'],
    keigoplus: ['敬語', '改まった・ビジネス'],
    emperor: ['皇室', '古風・儀式的'],
  },
  'zh-CN': {
    yakuza: ['粗话', '街头 · 粗鲁'],
    friend: ['朋友', '随意聊天'],
    casual: ['日常', '中性日常'],
    keigo: ['礼貌', '客气 · 尊重'],
    keigoplus: ['正式', '公务 · 庄重'],
    emperor: ['皇室', '古风 · 典礼'],
  },
  'zh-TW': {
    yakuza: ['粗話', '街頭 · 粗魯'],
    friend: ['朋友', '輕鬆聊天'],
    casual: ['日常', '自然日常'],
    keigo: ['禮貌', '客氣 · 尊重'],
    keigoplus: ['正式', '公務 · 莊重'],
    emperor: ['皇室', '古風 · 典禮'],
  },
  'th-TH': {
    yakuza: ['หยาบ', 'ภาษาข้างถนน'],
    friend: ['เพื่อน', 'ภาษากันเอง'],
    casual: ['ทั่วไป', 'ภาษาพูดทั่วไป'],
    keigo: ['สุภาพ', 'ภาษาสุภาพ'],
    keigoplus: ['ทางการ', 'ภาษาทางการ'],
    emperor: ['ราชาศัพท์', 'โบราณ · พิธีการ'],
  },
}

// Presets for a target language, labelled in the source language so the user
// can read the slider. English sources keep the target-tuned English labels.
export const getVibesForLang = (
  targetLang: string,
  sourceLang = 'en-US',
): VibePreset[] => {
  const vibes =
    VIBE_PRESETS_PER_LANG[targetLang as keyof typeof VIBE_PRESETS_PER_LANG] ||
    VIBE_PRESETS_DEFAULT
  const local = SOURCE_LABELS[sourceLang]
  if (!local) return vibes
  return vibes.map((v) => {
    const [label, hint] = local[v.id as VibeStopId]
    return { ...v, label, hint }
  })
}

// Header detail for the active stop: "Keigo · 丁寧語 · standard polite". The
// native term is dropped when it repeats the label (English targets).
export const vibeDetailParts = (v: VibePreset): string[] => [
  v.label,
  ...(v.native && v.native !== v.label ? [v.native] : []),
  ...v.hint.split(' · '),
]

// --- Sample characters/presets for the App page sidebar ---
export const SAMPLE_CHARS = [
  {
    id: 'c1',
    initials: 'お',
    name: 'Oba-chan',
    color: 'var(--magenta-400)',
    from: 'en-US',
    to: 'ja-JP',
    vibe: 'casual',
    temp: 0.4,
    persona: {
      age: '60s',
      region: 'Osaka',
      formality: 'warm but blunt',
      traits: ['warm', 'direct', 'uses 〜やん', 'dialect: kansai-ben'],
    },
    threadCount: 4,
  },
  {
    id: 'c2',
    initials: '部',
    name: 'Buchou-san',
    color: 'var(--cyan-400)',
    from: 'en-US',
    to: 'ja-JP',
    vibe: 'keigoplus',
    temp: 0.2,
    persona: {
      age: '50s',
      region: 'Tokyo',
      formality: 'business keigo',
      traits: ['precise', 'careful', 'uses 尊敬語', 'no slang'],
    },
    threadCount: 7,
  },
  {
    id: 'c3',
    initials: '友',
    name: 'Tomodachi',
    color: 'var(--orange-400)',
    from: 'en-US',
    to: 'ja-JP',
    vibe: 'friend',
    temp: 0.6,
    persona: {
      age: '20s',
      region: 'Tokyo',
      formality: 'タメ口',
      traits: ['casual', 'playful', 'uses じゃん', 'occasional slang'],
    },
    threadCount: 12,
  },
  {
    id: 'c4',
    initials: '陛',
    name: 'Heika',
    color: 'var(--magenta-400)',
    from: 'en-US',
    to: 'ja-JP',
    vibe: 'emperor',
    temp: 0.1,
    persona: {
      age: 'timeless',
      region: 'Imperial Court',
      formality: 'archaic ceremonial',
      traits: ['宮中言葉', 'classical grammar', 'no modern loanwords'],
    },
    threadCount: 1,
  },
  {
    id: 'c5',
    initials: 'BR',
    name: 'Marina · BR',
    color: 'var(--turq-400)',
    from: 'en-US',
    to: 'pt-BR',
    vibe: 'friend',
    temp: 0.5,
    persona: {
      age: '30s',
      region: 'São Paulo',
      formality: 'amigo',
      traits: ['carioca-adjacent', 'playful'],
    },
    threadCount: 3,
  },
  {
    id: 'c6',
    initials: '韓',
    name: 'Hyung',
    color: 'var(--blue-400)',
    from: 'en-US',
    to: 'ko-KR',
    vibe: 'keigo',
    temp: 0.3,
    persona: {
      age: '30s',
      region: 'Seoul',
      formality: '존댓말',
      traits: ['polite', 'occasional 형 address'],
    },
    threadCount: 5,
  },
]

// --- Sample threads (translations) for active character ---
// Each thread has a list of segments. Each segment has a source + target. Newer segments are at top.
export const SAMPLE_THREADS = {
  // For Oba-chan (c1)
  c1: [
    {
      id: 't1',
      title: "Asking for grandma's recipe",
      when: '2m ago',
      segCount: 3,
      segments: [
        {
          id: 's3',
          source: "Could you write down your recipe so I don't forget?",
          target: [
            { t: '忘れんように', src: "so I don't forget" },
            { t: '、', src: ',' },
            { t: 'レシピ', src: 'recipe' },
            { t: '、', src: '' },
            { t: '書いといて', src: 'write down' },
            { t: 'くれへん？', src: 'could you' },
          ],
          targetText: '忘れんように、レシピ書いといてくれへん？',
          tokens: 38,
        },
        {
          id: 's2',
          collapsed: true,
          source: 'It tastes amazing — what spices did you use?',
          target: [
            { t: 'めっちゃ', src: 'amazing' },
            { t: '美味しい', src: 'tastes' },
            { t: 'やん。', src: '(emphasis)' },
            { t: 'なんの', src: 'what' },
            { t: 'スパイス', src: 'spices' },
            { t: '入れたん', src: 'did you put' },
            { t: '？', src: '?' },
          ],
          targetText: 'めっちゃ美味しいやん。なんのスパイス入れたん？',
          tokens: 42,
        },
        {
          id: 's1',
          collapsed: true,
          source: "Hi grandma, I'm coming over for dinner tonight.",
          target: [
            { t: 'ばあちゃん', src: 'grandma' },
            { t: '、', src: ',' },
            { t: '今晩', src: 'tonight' },
            { t: '晩ご飯', src: 'dinner' },
            { t: '食べに', src: 'to eat' },
            { t: '行くわ', src: "I'm coming" },
            { t: '。', src: '.' },
          ],
          targetText: 'ばあちゃん、今晩晩ご飯食べに行くわ。',
          tokens: 30,
        },
      ],
    },
    {
      id: 't2',
      title: 'Telling her about the new apartment',
      when: '14m ago',
      segCount: 2,
      segments: [],
    },
    {
      id: 't3',
      title: 'Apologizing for missing her birthday',
      when: 'Yesterday',
      segCount: 5,
      segments: [],
    },
    {
      id: 't4',
      title: 'Asking how to pronounce the kanji on her name',
      when: '3d ago',
      segCount: 1,
      segments: [],
    },
  ],
  c2: [
    {
      id: 't5',
      title: 'Email: Q3 release notes review',
      when: 'just now',
      segCount: 4,
      segments: [],
    },
    {
      id: 't6',
      title: 'Decline a meeting invitation politely',
      when: '20m ago',
      segCount: 2,
      segments: [],
    },
    {
      id: 't7',
      title: 'Slack DM: status update on tokenizer fix',
      when: '1h ago',
      segCount: 3,
      segments: [],
    },
  ],
  c3: [
    {
      id: 't8',
      title: 'Texting about the weekend trip',
      when: '5m ago',
      segCount: 6,
      segments: [],
    },
    {
      id: 't9',
      title: 'Movie recommendation thread',
      when: '2h ago',
      segCount: 8,
      segments: [],
    },
  ],
  c4: [
    {
      id: 't10',
      title: 'Drafting a royal proclamation',
      when: '4d ago',
      segCount: 1,
      segments: [],
    },
  ],
  c5: [
    {
      id: 't11',
      title: 'WhatsApp: confirming Friday plans',
      when: '6m ago',
      segCount: 3,
      segments: [],
    },
  ],
  c6: [
    {
      id: 't12',
      title: 'Apologizing for being late',
      when: '1h ago',
      segCount: 2,
      segments: [],
    },
    {
      id: 't13',
      title: 'Asking a senior colleague for help',
      when: 'Yesterday',
      segCount: 4,
      segments: [],
    },
  ],
}

// --- Sample sentences for landing-page demo ---
export const DEMO_PAIRS_JA = {
  yakuza: '黙って俺について来い。後悔はさせねぇ。',
  friend: '黙ってついてきてよ。後悔はさせないから！',
  casual: '黙ってついてきてください。後悔はさせません。',
  keigo: 'お黙りになって、私についてきてください。ご後悔はさせません。',
  keigoplus:
    '恐れ入りますが、お言葉を控えていただき、私の後をご一緒くださいませ。ご後悔はさせません。',
  emperor: '言の葉を慎みて、朕に従ひ来たれ。後の悔ゆることなからしめむ。',
}

// Explain payload demo for the active segment in Oba-chan thread (s3)
export const EXPLAIN_DEMO_S3 = {
  source: "Could you write down your recipe so I don't forget?",
  target: '忘れんように、レシピ書いといてくれへん？',
  romaji: 'wasuren you ni, reshipi kaitoite kurehen?',
  literal: 'forget-not so-as, recipe write-and-keep give-(neg-question)?',
  morphemes: [
    {
      jp: '忘れん',
      rom: 'wasure-n',
      gloss: 'forget (negative, dialectal)',
      pos: 'verb',
      posColor: 'var(--orange-400)',
    },
    {
      jp: 'ように',
      rom: 'you ni',
      gloss: 'so that / in order to',
      pos: 'gram',
      posColor: 'var(--cyan-400)',
    },
    {
      jp: '、',
      rom: '',
      gloss: 'comma (pause)',
      pos: 'punct',
      posColor: 'var(--fg-subtle)',
    },
    {
      jp: 'レシピ',
      rom: 'reshipi',
      gloss: 'recipe (loanword, katakana)',
      pos: 'noun',
      posColor: 'var(--magenta-400)',
    },
    {
      jp: '書いといて',
      rom: 'kaitoite',
      gloss: 'write down and keep (て-form + おく contracted)',
      pos: 'verb',
      posColor: 'var(--orange-400)',
    },
    {
      jp: 'くれへん？',
      rom: 'kurehen?',
      gloss: "won't you give-me? (Kansai-ben negative request)",
      pos: 'aux+q',
      posColor: 'var(--turq-400)',
    },
  ],
  kanji: [
    {
      c: '忘',
      meaning: 'forget',
      on: 'BOU, MOU',
      kun: 'wasu(reru)',
      radicals: ['亡 (perish)', '心 (heart)'],
      jlpt: 'N3',
      strokes: 7,
    },
    {
      c: '書',
      meaning: 'write',
      on: 'SHO',
      kun: 'ka(ku)',
      radicals: ['聿 (writing brush)', '曰 (say)'],
      jlpt: 'N4',
      strokes: 10,
    },
  ],
  grammar: [
    {
      pat: '〜ないように / 〜んように',
      desc: '“So that ... not” — expresses purpose to avoid an outcome. Standard form is 〜ないように; Kansai dialect contracts to 〜んように.',
    },
    {
      pat: '〜ておく → 〜とく',
      desc: 'Aspectual auxiliary meaning “do something in advance / leave it done.” Casual contraction of 書いておいて → 書いといて.',
    },
    {
      pat: '〜くれへん？',
      desc: 'Kansai-ben negative request, equivalent to standard くれない？ — softens the ask with a friendly, regional flavor.',
    },
  ],
}

// Map ISO code → flag for headers
export const LANG_FLAG = {
  'en-US': '🇺🇸',
  'en-GB': '🇬🇧',
  'ja-JP': '🇯🇵',
  'ko-KR': '🇰🇷',
  'pt-BR': '🇧🇷',
  'fr-FR': '🇫🇷',
  'de-DE': '🇩🇪',
  'es-ES': '🇪🇸',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
  'th-TH': '🇹🇭',
  'ar-SA': '🇸🇦',
  'tr-TR': '🇹🇷',
}
export const LANG_NAME = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
  'pt-BR': 'Portuguese (BR)',
  'fr-FR': 'French',
  'de-DE': 'German',
  'es-ES': 'Spanish',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'th-TH': 'Thai',
  'ar-SA': 'Arabic',
  'tr-TR': 'Turkish',
}

export type SampleCharacter = (typeof SAMPLE_CHARS)[number]
export type SampleThread =
  (typeof SAMPLE_THREADS)[keyof typeof SAMPLE_THREADS][number]
export type SampleSegment = NonNullable<SampleThread['segments']>[number]
