import type { CSSProperties } from 'react'

// Inline-style helper for CSS custom properties (`--char-color` etc.), typed so
// React's CSSProperties accepts them without casts.
export type CSSVars = CSSProperties & Record<`--${string}`, string | number | undefined>

export const cssVars = (vars: CSSVars): CSSVars => vars
