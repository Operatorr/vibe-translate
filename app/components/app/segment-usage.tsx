import * as React from 'react'

import { Popover } from '@/components/ui/popover'

// Counts come from the provider, including the prompt and structured output.
// Missing legacy fields stay unknown; do not substitute a sample or estimate.
function count(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function SegmentUsage({
  usage = {},
}: {
  usage?: Record<string, unknown>
}) {
  const [open, setOpen] = React.useState(false)
  if (usage.cached === true)
    return <span className="segment__tgt-meta">cached · 0 credits</span>
  const input = count(usage.promptTokens)
  const output = count(usage.completionTokens)
  const charged = count(usage.creditsCharged)
  const total = input !== null && output !== null ? input + output : null
  if ((total ?? input ?? output ?? 0) === 0 && charged === null) return null
  const label =
    charged !== null
      ? `${charged.toLocaleString()} credits`
      : total !== null
        ? `${total.toLocaleString()} tok`
        : output !== null
          ? `${output.toLocaleString()} output tok`
          : `${input!.toLocaleString()} input tok`
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Translation usage"
      trigger={
        <button
          type="button"
          className="segment__tgt-meta segment__usage-trigger"
          aria-label={[
            total !== null
              ? `Token usage: ${total} total tokens`
              : 'Token usage: partial recording',
            charged !== null ? `${charged} credits charged` : null,
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {label}
        </button>
      }
    >
      <div className="segment__usage-breakdown">
        <h3>Translation usage</h3>
        <dl>
          <div>
            <dt>Input tokens</dt>
            <dd>{input?.toLocaleString() ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Output tokens</dt>
            <dd>{output?.toLocaleString() ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Total tokens</dt>
            <dd>{total?.toLocaleString() ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Credits charged</dt>
            <dd>{charged?.toLocaleString() ?? 'Not recorded'}</dd>
          </div>
        </dl>
        <p>
          Input includes your text, translation instructions and character
          settings. Output includes the translation and word alignment.
        </p>
        <p>
          Platform credit charges use input and output tokens and the model’s
          credit rate. The credits page shows the actual charge. Cached
          translations and your own OpenRouter key use no credits.
        </p>
      </div>
    </Popover>
  )
}
