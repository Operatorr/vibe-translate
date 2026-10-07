import * as Dialog from '@radix-ui/react-dialog'

import { Icon } from '@/components/vibe-design/icon'

const HELP = {
  verbosity: {
    title: 'Verbosity',
    summary: 'Controls how briefly or fully the translation is phrased.',
    detail:
      'Lower values use compact phrasing. Higher values allow fuller sentences and more connective wording. The meaning stays the same: this should not add facts or explanations. At the default of 0.40, the translation uses its natural length.',
    example: 'Example meaning: “I’ll arrive tomorrow.”',
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
    examples: [
      ['Low · predictable', '明天见。'],
      ['High · possible variation', '明天再见。 / 我们明天见。'],
    ],
    note: 'These are illustrative possibilities, not guaranteed outputs. The selected vibe still controls formality at every temperature.',
  },
}

export function CharacterSettingHelp({
  setting,
  onOpenChange,
}: {
  setting: keyof typeof HELP
  onOpenChange: (open: boolean) => void
}) {
  const help = HELP[setting]
  return (
    <Dialog.Root onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="cust__help-button"
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
          <p>{help.detail}</p>
          <p className="cust-help__example-label">{help.example}</p>
          <dl className="cust-help__examples">
            {help.examples.map(([label, example]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{example}</dd>
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
