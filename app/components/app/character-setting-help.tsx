import * as Dialog from '@radix-ui/react-dialog'

import { Icon } from '@/components/vibe-design/icon'

type Help = {
  title: string
  summary: string
  detail?: string
  // Headed paragraphs, for settings with more than one option to explain.
  sections?: ReadonlyArray<{ heading: string; body: string }>
  example: string
  exampleLang: string
  examples: ReadonlyArray<readonly [label: string, text: string]>
  note: string
}

const HELP = {
  verbosity: {
    title: 'Verbosity',
    summary: 'Controls how briefly or fully the translation is phrased.',
    detail:
      'Lower values use compact phrasing. Higher values allow fuller sentences and more connective wording. The meaning stays the same: this should not add facts or explanations. At the default of 0.40, the translation uses its natural length.',
    example: 'Example meaning: “I’ll arrive tomorrow.”',
    exampleLang: 'zh-CN',
    examples: [
      ['Low · compact', '明天到。'],
      ['Default · natural', '我明天会到。'],
      ['High · fuller', '我会在明天到达。'],
    ],
    note: 'Examples show length differences in Simplified Chinese. Your selected language, vibe and region still apply.',
  },
  temperature: {
    title: 'Temperature',
    summary: 'Controls how much the wording can vary between translations.',
    detail:
      'Lower values favour more predictable word choices. Higher values allow more variation in phrasing and idioms. Temperature does not set politeness or length, and it should not change the meaning. Even at 0, identical wording is not guaranteed; a saved or cached translation may also stay the same.',
    example: 'Example meaning: “See you tomorrow.”',
    exampleLang: 'zh-CN',
    examples: [
      ['Low · predictable', '明天见。'],
      ['High · possible variation', '明天再见。 / 我们明天见。'],
    ],
    note: 'These are illustrative possibilities, not guaranteed outputs. The selected vibe still controls formality at every temperature.',
  },
  perspective: {
    title: 'Perspective',
    summary: 'Who is talking in the translation: the character, or you.',
    sections: [
      {
        heading: 'As the speaker',
        body: 'You put words in the character’s mouth. The translation is what they would say, in their own voice: how they refer to themselves, their attitude, their dialect. The vibe describes how the character talks. Pick this to practise sounding like someone, or to write their lines.',
      },
      {
        heading: 'To the speaker',
        body: 'You talk to the character, in your own voice. The translation is your message to them. The vibe describes who you are addressing and how to speak to someone like that, so you never borrow their way of talking. Their age and region still shape the wording, so the message reads naturally to them.',
      },
      {
        heading: 'Which one?',
        body: 'Messaging a real person, like a friend, your boss or your grandmother: To the speaker. Role-play, writing dialogue, or learning how a type of person talks: As the speaker. Friend, Casual and Keigo come out much the same either way; Yakuza, Keigo+ and Emperor change the most.',
      },
    ],
    example: 'Example meaning: “Come here.”',
    exampleLang: 'ja-JP',
    examples: [
      ['Emperor · as the speaker', '朕のもとへ参れ。'],
      [
        'Emperor · to the speaker',
        '陛下、どうぞこちらへお出ましくださいませ。',
      ],
      ['Yakuza · as the speaker', 'おい、こっち来いや。'],
      ['Yakuza · to the speaker', '兄貴、ちょっとこっちに来てもらえますか。'],
    ],
    note: 'Examples are in Japanese and illustrative, not guaranteed outputs. Perspective is saved on the character, and each translation records the one it used.',
  },
} satisfies Record<string, Help>

export function CharacterSettingHelp({
  setting,
  onOpenChange,
  compact,
}: {
  setting: keyof typeof HELP
  // The Character panel listens so Escape closes the help, not the panel.
  onOpenChange?: (open: boolean) => void
  // A smaller trigger for dense rows such as the composer's settings drawer.
  compact?: boolean
}) {
  const help: Help = HELP[setting]
  return (
    <Dialog.Root onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={
            'cust__help-button' + (compact ? ' cust__help-button--compact' : '')
          }
          aria-label={`About ${help.title.toLowerCase()}`}
        >
          <span aria-hidden="true">?</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="cust-help__overlay" />
        <Dialog.Content
          className="cust-help"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <div className="cust-help__head">
            <Dialog.Title className="cust-help__title">
              {help.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="cust__close"
                aria-label="Close help"
              >
                <Icon name="x" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="cust-help__summary">
            {help.summary}
          </Dialog.Description>
          {help.detail && <p>{help.detail}</p>}
          {help.sections?.map((section) => (
            <section key={section.heading} className="cust-help__section">
              <h3 className="cust-help__section-h">{section.heading}</h3>
              <p>{section.body}</p>
            </section>
          ))}
          <p className="cust-help__example-label">{help.example}</p>
          <dl className="cust-help__examples">
            {help.examples.map(([label, example]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd lang={help.exampleLang}>{example}</dd>
              </div>
            ))}
          </dl>
          <p className="cust__helper">{help.note}</p>
          <Dialog.Close asChild>
            <button type="button" className="vt-btn vt-btn--primary">
              Got it
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
