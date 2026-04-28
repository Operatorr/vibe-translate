// data.js — shared sample data: characters/presets, threads, vibe presets per language

window.VIBE_PRESETS_PER_LANG = {
  'ja-JP': [
    { id: 'yakuza',   label: 'Yakuza',    hint: 'rough · 俺・お前・なめんなよ',     color: 'var(--red-400)' },
    { id: 'friend',   label: 'Friend',    hint: 'タメ口 · お疲れ・〜じゃん',        color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',    hint: 'です・ます · light politeness',    color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Keigo',     hint: '丁寧語 · standard polite',         color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Keigo+',    hint: '尊敬語 · honorifics, business',    color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Emperor',   hint: '宮中言葉 · archaic, ceremonial',    color: 'var(--magenta-400)' },
  ],
  'ko-KR': [
    { id: 'yakuza',   label: 'Banmal-',  hint: 'rough · 야 · 너',               color: 'var(--red-400)' },
    { id: 'friend',   label: 'Banmal',    hint: '반말 · friends, family',         color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',    hint: '해요체 · standard polite',       color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Jondaemal', hint: '존댓말 · formal',                color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Hapsyo',    hint: '합쇼체 · business, broadcast',   color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Royal',     hint: 'archaic court speech',           color: 'var(--magenta-400)' },
  ],
  'en-US': [
    { id: 'yakuza',   label: 'Gritty',  hint: 'street · cussing ok',          color: 'var(--red-400)' },
    { id: 'friend',   label: 'Buddy',   hint: 'slack · contractions',         color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',  hint: 'newsletter voice',             color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Polite',  hint: 'docs default',                 color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Formal',  hint: 'press release · cover letter', color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Lordly',  hint: 'thy / thee · ceremonial',      color: 'var(--magenta-400)' },
  ],
  'pt-BR': [
    { id: 'yakuza',   label: 'Boca-suja',hint: 'rua · gírias pesadas',         color: 'var(--red-400)' },
    { id: 'friend',   label: 'Amigo',    hint: 'mano · cara · tipo',           color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',   hint: 'voz de podcast',                color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Polido',   hint: 'você · pronome de tratamento',  color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Formal',   hint: 'senhor · cargo público',         color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Cortês',   hint: 'vossa mercê · arcaico',          color: 'var(--magenta-400)' },
  ],
  'fr-FR': [
    { id: 'yakuza',   label: 'Argot',    hint: 'verlan · grossier',           color: 'var(--red-400)' },
    { id: 'friend',   label: 'Pote',     hint: 'tu · familier',                color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',   hint: 'tu · neutre',                  color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Vous',     hint: 'vouvoiement · pro',            color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Formel',   hint: 'monsieur · administratif',     color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Royal',    hint: 'précieux · académique',        color: 'var(--magenta-400)' },
  ],
  'de-DE': [
    { id: 'yakuza',   label: 'Derb',     hint: 'Berliner · derbe Sprache',     color: 'var(--red-400)' },
    { id: 'friend',   label: 'Du',       hint: 'duzen · Kumpel',                color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',   hint: 'Du · neutral',                  color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Sie',      hint: 'siezen · höflich',              color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Förmlich', hint: 'Herr/Frau · amtlich',           color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Majestät', hint: 'höfisch · historisch',          color: 'var(--magenta-400)' },
  ],
  'es-ES': [
    { id: 'yakuza',   label: 'Tacos',    hint: 'callejero · vulgar',            color: 'var(--red-400)' },
    { id: 'friend',   label: 'Tío',      hint: 'tuteo · entre amigos',           color: 'var(--orange-400)' },
    { id: 'casual',   label: 'Casual',   hint: 'tú · neutro',                    color: 'var(--amber-400)' },
    { id: 'keigo',    label: 'Usted',    hint: 'cortés · profesional',           color: 'var(--turq-400)' },
    { id: 'keigoplus',label: 'Formal',   hint: 'Don · administrativo',           color: 'var(--cyan-400)' },
    { id: 'emperor',  label: 'Real',     hint: 'Su Majestad · arcaico',          color: 'var(--magenta-400)' },
  ],
  'zh-CN': [
    { id: 'yakuza',   label: '糙话',    hint: '街头 · 粗鲁',     color: 'var(--red-400)' },
    { id: 'friend',   label: '朋友',    hint: '哥们 · 随便聊',    color: 'var(--orange-400)' },
    { id: 'casual',   label: '日常',    hint: '中性日常',         color: 'var(--amber-400)' },
    { id: 'keigo',    label: '礼貌',    hint: '您 · 商务',        color: 'var(--turq-400)' },
    { id: 'keigoplus',label: '正式',    hint: '尊敬 · 公文',      color: 'var(--cyan-400)' },
    { id: 'emperor',  label: '皇室',    hint: '朕 · 古风',        color: 'var(--magenta-400)' },
  ],
};

// Default fallback
window.VIBE_PRESETS_DEFAULT = window.VIBE_PRESETS_PER_LANG['en-US'];

window.getVibesForLang = (langCode) => window.VIBE_PRESETS_PER_LANG[langCode] || window.VIBE_PRESETS_DEFAULT;

// --- Sample characters/presets for the App page sidebar ---
window.SAMPLE_CHARS = [
  {
    id: 'c1', initials: 'お', name: 'Oba-chan',
    color: 'var(--magenta-400)',
    from: 'en-US', to: 'ja-JP',
    vibe: 'casual', temp: 0.4,
    persona: { age: '60s', region: 'Osaka', formality: 'warm but blunt', traits: ['warm','direct','uses 〜やん','dialect: kansai-ben'] },
    threadCount: 4,
  },
  {
    id: 'c2', initials: '部', name: 'Buchou-san',
    color: 'var(--cyan-400)',
    from: 'en-US', to: 'ja-JP',
    vibe: 'keigoplus', temp: 0.2,
    persona: { age: '50s', region: 'Tokyo', formality: 'business keigo', traits: ['precise','careful','uses 尊敬語','no slang'] },
    threadCount: 7,
  },
  {
    id: 'c3', initials: '友', name: 'Tomodachi',
    color: 'var(--orange-400)',
    from: 'en-US', to: 'ja-JP',
    vibe: 'friend', temp: 0.6,
    persona: { age: '20s', region: 'Tokyo', formality: 'タメ口', traits: ['casual','playful','uses じゃん','occasional slang'] },
    threadCount: 12,
  },
  {
    id: 'c4', initials: '陛', name: 'Heika',
    color: 'var(--magenta-400)',
    from: 'en-US', to: 'ja-JP',
    vibe: 'emperor', temp: 0.1,
    persona: { age: 'timeless', region: 'Imperial Court', formality: 'archaic ceremonial', traits: ['宮中言葉','classical grammar','no modern loanwords'] },
    threadCount: 1,
  },
  {
    id: 'c5', initials: 'BR', name: 'Marina · BR',
    color: 'var(--turq-400)',
    from: 'en-US', to: 'pt-BR',
    vibe: 'friend', temp: 0.5,
    persona: { age: '30s', region: 'São Paulo', formality: 'amigo', traits: ['carioca-adjacent','playful'] },
    threadCount: 3,
  },
  {
    id: 'c6', initials: '韓', name: 'Hyung',
    color: 'var(--blue-400)',
    from: 'en-US', to: 'ko-KR',
    vibe: 'keigo', temp: 0.3,
    persona: { age: '30s', region: 'Seoul', formality: '존댓말', traits: ['polite','occasional 형 address'] },
    threadCount: 5,
  },
];

// --- Sample threads (translations) for active character ---
// Each thread has a list of segments. Each segment has a source + target. Newer segments are at top.
window.SAMPLE_THREADS = {
  // For Oba-chan (c1)
  c1: [
    {
      id: 't1', title: 'Asking for grandma\'s recipe', when: '2m ago', segCount: 3,
      segments: [
        {
          id: 's3',
          source: 'Could you write down your recipe so I don\'t forget?',
          target: [
            { t:'忘れんように', src:'so I don\'t forget' },
            { t:'、', src:',' },
            { t:'レシピ', src:'recipe' },
            { t:'、', src:'' },
            { t:'書いといて', src:'write down' },
            { t:'くれへん？', src:'could you' },
          ],
          targetText: '忘れんように、レシピ書いといてくれへん？',
          tokens: 38,
        },
        {
          id: 's2', collapsed: true,
          source: 'It tastes amazing — what spices did you use?',
          target: [
            { t:'めっちゃ', src:'amazing' },
            { t:'美味しい', src:'tastes' },
            { t:'やん。', src:'(emphasis)' },
            { t:'なんの', src:'what' },
            { t:'スパイス', src:'spices' },
            { t:'入れたん', src:'did you put' },
            { t:'？', src:'?' },
          ],
          targetText: 'めっちゃ美味しいやん。なんのスパイス入れたん？',
          tokens: 42,
        },
        {
          id: 's1', collapsed: true,
          source: 'Hi grandma, I\'m coming over for dinner tonight.',
          target: [
            { t:'ばあちゃん', src:'grandma' },
            { t:'、', src:',' },
            { t:'今晩', src:'tonight' },
            { t:'晩ご飯', src:'dinner' },
            { t:'食べに', src:'to eat' },
            { t:'行くわ', src:'I\'m coming' },
            { t:'。', src:'.' },
          ],
          targetText: 'ばあちゃん、今晩晩ご飯食べに行くわ。',
          tokens: 30,
        },
      ],
    },
    { id: 't2', title: 'Telling her about the new apartment', when: '14m ago', segCount: 2, segments: [] },
    { id: 't3', title: 'Apologizing for missing her birthday', when: 'Yesterday', segCount: 5, segments: [] },
    { id: 't4', title: 'Asking how to pronounce the kanji on her name', when: '3d ago', segCount: 1, segments: [] },
  ],
  c2: [
    { id: 't5', title: 'Email: Q3 release notes review', when: 'just now', segCount: 4, segments: [] },
    { id: 't6', title: 'Decline a meeting invitation politely', when: '20m ago', segCount: 2, segments: [] },
    { id: 't7', title: 'Slack DM: status update on tokenizer fix', when: '1h ago', segCount: 3, segments: [] },
  ],
  c3: [
    { id: 't8', title: 'Texting about the weekend trip', when: '5m ago', segCount: 6, segments: [] },
    { id: 't9', title: 'Movie recommendation thread', when: '2h ago', segCount: 8, segments: [] },
  ],
  c4: [
    { id: 't10', title: 'Drafting a royal proclamation', when: '4d ago', segCount: 1, segments: [] },
  ],
  c5: [
    { id: 't11', title: 'WhatsApp: confirming Friday plans', when: '6m ago', segCount: 3, segments: [] },
  ],
  c6: [
    { id: 't12', title: 'Apologizing for being late', when: '1h ago', segCount: 2, segments: [] },
    { id: 't13', title: 'Asking a senior colleague for help', when: 'Yesterday', segCount: 4, segments: [] },
  ],
};

// --- Sample sentences for landing-page demo ---
window.DEMO_PAIRS_JA = {
  yakuza:   '黙って俺について来い。後悔はさせねぇ。',
  friend:   '黙ってついてきてよ。後悔はさせないから！',
  casual:   '黙ってついてきてください。後悔はさせません。',
  keigo:    'お黙りになって、私についてきてください。ご後悔はさせません。',
  keigoplus:'恐れ入りますが、お言葉を控えていただき、私の後をご一緒くださいませ。ご後悔はさせません。',
  emperor:  '言の葉を慎みて、朕に従ひ来たれ。後の悔ゆることなからしめむ。',
};

// Explain payload demo for the active segment in Oba-chan thread (s3)
window.EXPLAIN_DEMO_S3 = {
  source: 'Could you write down your recipe so I don\'t forget?',
  target: '忘れんように、レシピ書いといてくれへん？',
  romaji: 'wasuren you ni, reshipi kaitoite kurehen?',
  literal: 'forget-not so-as, recipe write-and-keep give-(neg-question)?',
  morphemes: [
    { jp: '忘れん', rom: 'wasure-n', gloss: 'forget (negative, dialectal)', pos: 'verb', posColor: 'var(--orange-400)' },
    { jp: 'ように', rom: 'you ni',   gloss: 'so that / in order to',        pos: 'gram',  posColor: 'var(--cyan-400)' },
    { jp: '、',     rom: '',          gloss: 'comma (pause)',                pos: 'punct', posColor: 'var(--fg-subtle)' },
    { jp: 'レシピ',  rom: 'reshipi',   gloss: 'recipe (loanword, katakana)',  pos: 'noun',  posColor: 'var(--magenta-400)' },
    { jp: '書いといて', rom: 'kaitoite', gloss: 'write down and keep (て-form + おく contracted)', pos: 'verb', posColor: 'var(--orange-400)' },
    { jp: 'くれへん？', rom: 'kurehen?', gloss: 'won\'t you give-me? (Kansai-ben negative request)', pos: 'aux+q', posColor: 'var(--turq-400)' },
  ],
  kanji: [
    { c: '忘', meaning: 'forget', on: 'BOU, MOU', kun: 'wasu(reru)', radicals: ['亡 (perish)','心 (heart)'], jlpt: 'N3', strokes: 7 },
    { c: '書', meaning: 'write', on: 'SHO',       kun: 'ka(ku)',     radicals: ['聿 (writing brush)','曰 (say)'], jlpt: 'N4', strokes: 10 },
  ],
  grammar: [
    { pat: '〜ないように / 〜んように', desc: '“So that ... not” — expresses purpose to avoid an outcome. Standard form is 〜ないように; Kansai dialect contracts to 〜んように.' },
    { pat: '〜ておく → 〜とく', desc: 'Aspectual auxiliary meaning “do something in advance / leave it done.” Casual contraction of 書いておいて → 書いといて.' },
    { pat: '〜くれへん？', desc: 'Kansai-ben negative request, equivalent to standard くれない？ — softens the ask with a friendly, regional flavor.' },
  ],
};

// Map ISO code → flag for headers
window.LANG_FLAG = { 'en-US':'🇺🇸','en-GB':'🇬🇧','ja-JP':'🇯🇵','ko-KR':'🇰🇷','pt-BR':'🇧🇷','fr-FR':'🇫🇷','de-DE':'🇩🇪','es-ES':'🇪🇸','zh-CN':'🇨🇳','ar-SA':'🇸🇦','tr-TR':'🇹🇷' };
window.LANG_NAME = { 'en-US':'English (US)','en-GB':'English (UK)','ja-JP':'Japanese','ko-KR':'Korean','pt-BR':'Portuguese (BR)','fr-FR':'French','de-DE':'German','es-ES':'Spanish','zh-CN':'Chinese (S)','ar-SA':'Arabic','tr-TR':'Turkish' };
