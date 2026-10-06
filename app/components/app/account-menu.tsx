import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as React from 'react'
import { toast } from 'sonner'

import { Icon } from '@/components/vibe-design/icon'
import { authClient, signOut } from '@/lib/auth-client'
import { initialsFor } from '@/lib/initials'

// Top-nav account slot on /app: who's signed in, plus sign-out.
export function AccountMenu() {
  const { data } = authClient.useSession()
  const [open, setOpen] = React.useState(false)
  const user = data?.user
  if (!user) return null
  const label = user.name || user.email

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={'account-btn ' + (open ? 'is-active' : '')}
          title={label}
          aria-label="Account"
        >
          {initialsFor(label)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="vt-popover vt-menu"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          <DropdownMenu.Label className="account-menu__who">
            {user.name && <strong>{user.name}</strong>}
            <span>{user.email}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="vt-menu__sep" />
          <DropdownMenu.Item
            className="vt-menu__item"
            onSelect={() =>
              void signOut().catch((error: unknown) => {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : 'Could not sign out.',
                )
              })
            }
          >
            <Icon name="log-out" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
