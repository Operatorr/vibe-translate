import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as React from 'react'
import { toast } from 'sonner'

import { Popover } from '@/components/ui/popover'
import { Icon } from '@/components/vibe-design/icon'
import type { ThreadShare } from '@/lib/types'
import { copyText } from '@/lib/clipboard'

// "More" menu on the workspace header. Rename / archive / delete the thread,
// plus a copy-as-Markdown shortcut that mirrors the download button. Radix
// DropdownMenu supplies real `menu`/`menuitem` semantics, arrow-key roving
// focus, typeahead, and focus return.
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
  // Rename focuses the title input; don't let the menu pull focus back to its
  // trigger on close. Every other item returns focus normally.
  const keepFocus = React.useRef(false)
  const item = (
    icon: string,
    label: string,
    fn: () => void,
    opts: { danger?: boolean; ownsFocus?: boolean } = {},
  ) => (
    <DropdownMenu.Item
      className={
        'vt-menu__item ' + (opts.danger ? 'vt-menu__item--danger' : '')
      }
      onSelect={() => {
        keepFocus.current = opts.ownsFocus === true
        fn()
      }}
    >
      <Icon name={icon} /> {label}
    </DropdownMenu.Item>
  )
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={'workspace__icon-btn ' + (open ? 'is-active' : '')}
          title="More"
          aria-label="Thread options"
        >
          <Icon name="more-horizontal" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="vt-popover vt-menu"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault()
            keepFocus.current = false
          }}
        >
          {item('pencil', 'Rename thread', onRename, { ownsFocus: true })}
          {item('copy', 'Copy as Markdown', onCopyMarkdown)}
          {onClearExplain &&
            item('book-open', 'Close explain panels', onClearExplain)}
          <DropdownMenu.Separator className="vt-menu__sep" />
          {item('archive', 'Archive thread', onArchive)}
          {item('trash', 'Delete thread', onDelete, { danger: true })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  // Status not known yet: render the switch in a neutral state rather than
  // "off", which would snap on when the query returns.
  const checking = share === undefined && loading
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
          type="button"
          className={'workspace__icon-btn ' + (shared ? 'is-active' : '')}
          title="Share"
          aria-label="Share thread"
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
              {checking
                ? 'Checking link status…'
                : 'Anyone with the link can read this thread — no account needed.'}
            </div>
          </div>
          <button
            type="button"
            className={
              'vt-switch ' +
              (shared ? 'is-on ' : '') +
              (checking ? 'is-loading' : '')
            }
            role="switch"
            aria-checked={shared}
            aria-busy={loading}
            aria-label="Public link"
            disabled={loading}
            onClick={() => onToggle(!shared)}
          >
            <span />
          </button>
        </div>
        {shared && share?.url && (
          <div className="vt-share__link">
            <input
              readOnly
              name="share-url"
              aria-label="Public share link"
              value={share.url}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="vt-btn vt-btn--primary"
              onClick={() => void copy()}
            >
              <Icon name="copy" /> Copy
            </button>
          </div>
        )}
        {shared && (
          <button
            type="button"
            className="vt-share__revoke"
            onClick={() => onToggle(false)}
            disabled={loading}
          >
            <Icon name="link-off" /> Disable link
          </button>
        )}
      </div>
    </Popover>
  )
}
