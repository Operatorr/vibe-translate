import type * as React from 'react'

// Pointer handlers for a stepped rail (the Vibe slider). Press anywhere on the
// rail to jump to the nearest stop, then drag: the value snaps from stop to
// stop under the finger. Pointer capture keeps the drag alive when the finger
// leaves the rail; pair with `touch-action: none` so touch drags aren't taken
// as page scrolls. Only stop changes reach `onChange`.
export function snapDragHandlers(
  count: number,
  value: number,
  onChange: (index: number) => void,
) {
  const pick = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (count < 2 || rect.width === 0) return
    const at = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const next = Math.round(at * (count - 1))
    if (next !== value) onChange(next)
  }
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      pick(e)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) pick(e)
    },
  }
}
