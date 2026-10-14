// Balances, ledger deltas, purchase snapshots and API payloads use whole Credits.
// One Credit represents ten model tokens, rounded per completed request.
export const TOKENS_PER_CREDIT = 10
export const toCredits = (credits: number): number => credits
export const fromCredits = (credits: number): number => credits
