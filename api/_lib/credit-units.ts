// Keep accounting in integer microdollars; expose Credits at API boundaries.
// One displayed credit buys $0.00001 of provider usage (10 accounting units).
export const UNITS_PER_DOLLAR = 1_000_000
export const UNITS_PER_CREDIT = 10
export const toCredits = (units: number): number => units / UNITS_PER_CREDIT
export const fromCredits = (credits: number): number =>
  credits * UNITS_PER_CREDIT

export function dollarUnits(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0)
    throw new Error('Invalid provider cost')
  // Tolerate floating point noise at exact microdollar boundaries.
  return Math.max(0, Math.ceil(dollars * UNITS_PER_DOLLAR - 1e-9))
}
