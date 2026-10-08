import * as React from 'react'

// Open state for the Share popover, owned by the shell: share status loads only
// while it's open. Keyed by Thread, so a newly selected Thread is closed (and
// its lazy read disabled) from its first render, and a header that unmounts
// while open can't leave the flag set for a later visit.
export function useShareOpen(threadId: string | null) {
  const [openFor, setOpenFor] = React.useState<string | null>(null)
  React.useEffect(() => {
    setOpenFor((curr) => (curr === threadId ? curr : null))
  }, [threadId])
  const setOpen = React.useCallback(
    (open: boolean) => setOpenFor(open ? threadId : null),
    [threadId],
  )
  return [threadId !== null && openFor === threadId, setOpen] as const
}
