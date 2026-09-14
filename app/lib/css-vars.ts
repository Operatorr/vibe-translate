import type { CSSProperties } from 'react'

// Inline-style helper for CSS custom properties (`--char-color` etc.), typed so
// React's CSSProperties accepts them without casts.
export type CSSVars = CSSProperties &
  Record<`--${string}`, string | number | undefined>

export const cssVars = (vars: CSSVars): CSSVars => vars

// Character colors reach inline styles from the API (including the public share
// payload). Only plain color syntaxes pass — never `url(...)` or other values
// that could make the browser fetch something.
const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\)|(rgb|hsl)a?\([\d\s.,%/]+\))$/i

export const safeCssColor = (
  color: string | null | undefined,
  fallback = 'var(--blue-400)',
) => (color && SAFE_COLOR.test(color.trim()) ? color.trim() : fallback)
