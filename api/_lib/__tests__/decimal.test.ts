import { describe, expect, it } from 'vitest'

import { addDecimals, ceilScaledWithPercent, toDecimal } from '../decimal'

describe('toDecimal', () => {
  it('reads the shortest decimal representation, including exponents', () => {
    expect(toDecimal(0.0041)).toEqual({ digits: 41n, scale: 4 })
    expect(toDecimal(1e-7)).toEqual({ digits: 1n, scale: 7 })
    expect(toDecimal(1e21)).toEqual({ digits: 10n ** 21n, scale: 0 })
  })
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (value) => {
    expect(() => toDecimal(value)).toThrow()
  })
})

describe('addDecimals', () => {
  it('sums without binary floating-point noise', () => {
    expect(addDecimals(0.1, 0.2)).toBe(0.3)
    expect(addDecimals(0.0001068, 0.000125)).toBe(0.0002318)
    expect(addDecimals(1e-7, 2e-8)).toBe(1.2e-7)
  })
})

describe('ceilScaledWithPercent', () => {
  it('rounds exact products as-is and genuine fractions up', () => {
    expect(ceilScaledWithPercent(0.0041, 700_000, 30)).toBe(3731n)
    expect(ceilScaledWithPercent(0.0001068, 700_000, 30)).toBe(98n)
    expect(ceilScaledWithPercent(0.001, 700_000, 12.5)).toBe(788n)
    expect(ceilScaledWithPercent(0.00000100001, 700_000, 0)).toBe(1n)
    expect(ceilScaledWithPercent(0, 700_000, 30)).toBe(0n)
  })
})
