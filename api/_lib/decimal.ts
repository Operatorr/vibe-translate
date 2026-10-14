// Exact decimal arithmetic for provider USD costs. Binary floats turn values
// like 0.0041 × 700,000 × 1.3 into 3731.000000000001, which a ceiling would
// bill as an extra Credit. A number's shortest round-trip string is the decimal
// the provider reported, so scale that to an integer and do the math in bigint.

export type Decimal = { digits: bigint; scale: number }

export function toDecimal(value: number): Decimal {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Decimal value must be finite and non-negative')
  const [mantissa, exponent = '0'] = value.toString().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = BigInt(whole + fraction)
  const scale = fraction.length - Number(exponent)
  return scale >= 0
    ? { digits, scale }
    : { digits: digits * 10n ** BigInt(-scale), scale: 0 }
}

const rescale = (value: Decimal, scale: number): bigint =>
  value.digits * 10n ** BigInt(scale - value.scale)

export function addDecimals(a: number, b: number): number {
  const left = toDecimal(a)
  const right = toDecimal(b)
  const scale = Math.max(left.scale, right.scale)
  const digits = (rescale(left, scale) + rescale(right, scale)).toString()
  return Number(scale === 0 ? digits : `${digits}e-${scale}`)
}

// ceil(value × factor × (100 + percent) / 100), evaluated exactly.
export function ceilScaledWithPercent(
  value: number,
  factor: number,
  percent: number,
): bigint {
  const amount = toDecimal(value)
  const markup = toDecimal(percent)
  const numerator =
    amount.digits *
    BigInt(factor) *
    (100n * 10n ** BigInt(markup.scale) + markup.digits)
  const denominator = 100n * 10n ** BigInt(amount.scale + markup.scale)
  return (numerator + denominator - 1n) / denominator
}
