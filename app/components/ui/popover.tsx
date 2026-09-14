import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

// Anchored, portaled popover on Radix (DESIGN.md: keep Radix primitives for
// focus management and ARIA). Radix moves focus into the content on open,
// returns it to the trigger on close, dismisses on Escape / outside click /
// focus leaving, and sets `aria-expanded`/`aria-controls` on the trigger.
// `trigger` must be a single focusable element (rendered via `asChild`) and
// must not toggle `open` itself — Radix owns that.
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'end',
  label,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  children: React.ReactNode
  align?: 'start' | 'end'
  label: string
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="vt-popover"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
