// Balances, ledger deltas, purchase snapshots and API payloads use whole Credits.
// Keep the allowance/purchase scale established by migration 0014. Provider
// cost is converted at this rate before the platform markup is added.
export const CREDITS_PER_USD = 700_000
export const DEFAULT_CREDIT_MARKUP_PERCENT = 30
export const toCredits = (credits: number): number => credits
export const fromCredits = (credits: number): number => credits
