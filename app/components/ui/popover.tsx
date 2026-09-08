import * as React from 'react'

// Minimal anchored popover: renders `content` below the trigger and closes on
// outside click or Escape. Used for the thread options menu and share panel;
// small enough that pulling in another Radix package isn't worth it.
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
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'start' | 'end'
  label: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])
  return (
    <div className="vt-popover-anchor" ref={ref}>
      {trigger}
      {open && (
        <div className={`vt-popover vt-popover--${align}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}
