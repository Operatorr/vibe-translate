import * as React from 'react'
import { toast } from 'sonner'

import { Popover } from '@/components/ui/popover'
import { Icon } from '@/components/vibe-design/icon'
import type { ThreadShare } from '@/lib/types'
import { copyText } from '@/lib/clipboard'

// "More" menu on the workspace header. Rename / archive / delete the thread,
// plus a copy-as-Markdown shortcut that mirrors the download button.
export function ThreadOptionsMenu({
  onRename,
  onArchive,
  onDelete,
  onCopyMarkdown,
  onClearExplain,
}: {
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onCopyMarkdown: () => void
  onClearExplain?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const item = (icon: string, label: string, fn: () => void, danger = false) => (
    <button
      className={'vt-menu__item ' + (danger ? 'vt-menu__item--danger' : '')}
      onClick={() => {
        setOpen(false)
        fn()
      }}
    >
      <Icon name={icon} /> {label}
    </button>
  )
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Thread options"
      trigger={
        <button
          className={'workspace__icon-btn ' + (open ? 'is-active' : '')}
          title="More"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="more-horizontal" />
        </button>
      }
    >
      <div className="vt-menu" role="menu">
        {item('pencil', 'Rename thread', onRename)}
        {item('copy', 'Copy as Markdown', onCopyMarkdown)}
        {onClearExplain && item('book-open', 'Close explain panels', onClearExplain)}
        <div className="vt-menu__sep" />
        {item('archive', 'Archive thread', onArchive)}
        {item('trash', 'Delete thread', onDelete, true)}
      </div>
    </Popover>
  )
}

export function SharePopover({
  share,
  loading,
  onToggle,
}: {
  share: ThreadShare | undefined
  loading: boolean
  onToggle: (shared: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)
  const shared = share?.shared === true
  const copy = async () => {
    if (!share?.url) return
    try {
      await copyText(share.url)
      toast.success('Share link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Share thread"
      trigger={
        <button
          className={'workspace__icon-btn ' + (shared ? 'is-active' : '')}
          title="Share"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="share-2" />
        </button>
      }
    >
      <div className="vt-share">
        <div className="vt-share__row">
          <div>
            <div className="vt-share__title">Public link</div>
            <div className="vt-share__sub">
              Anyone with the link can read this thread — no account needed.
            </div>
          </div>
          <button
            className={'vt-switch ' + (shared ? 'is-on' : '')}
            role="switch"
            aria-checked={shared}
            aria-label="Public link"
            disabled={loading}
            onClick={() => onToggle(!shared)}
          >
            <span />
          </button>
        </div>
        {shared && share?.url && (
          <div className="vt-share__link">
            <input readOnly value={share.url} onFocus={(e) => e.target.select()} />
            <button className="vt-btn vt-btn--primary" onClick={() => void copy()}>
              <Icon name="copy" /> Copy
            </button>
          </div>
        )}
        {shared && (
          <button className="vt-share__revoke" onClick={() => onToggle(false)} disabled={loading}>
            <Icon name="link-off" /> Disable link
          </button>
        )}
      </div>
    </Popover>
  )
}
