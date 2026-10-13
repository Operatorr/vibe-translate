import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { snapDragHandlers } from '../snap-drag'

// A 500px rail with six stops: one stop every 100px.
function rail() {
  let captured = false
  const el = {
    getBoundingClientRect: () => ({ left: 0, width: 500 }),
    setPointerCapture: () => (captured = true),
    hasPointerCapture: () => captured,
  }
  const at = (clientX: number) =>
    ({
      button: 0,
      pointerId: 1,
      clientX,
      currentTarget: el,
    }) as unknown as React.PointerEvent<HTMLElement>
  return { at }
}

describe('snapDragHandlers', () => {
  it('jumps to the nearest stop on press and snaps while dragging', () => {
    const { at } = rail()
    const onChange = vi.fn()
    let value = 0
    const handlers = () =>
      snapDragHandlers(6, value, (i) => {
        value = i
        onChange(i)
      })
    handlers().onPointerDown(at(140))
    expect(value).toBe(1)
    handlers().onPointerMove(at(160))
    handlers().onPointerMove(at(340))
    handlers().onPointerMove(at(900))
    expect(onChange.mock.calls.map(([i]) => i)).toEqual([1, 2, 3, 5])
  })

  it('ignores hover moves without a press', () => {
    const { at } = rail()
    const onChange = vi.fn()
    snapDragHandlers(6, 0, onChange).onPointerMove(at(300))
    expect(onChange).not.toHaveBeenCalled()
  })
})
