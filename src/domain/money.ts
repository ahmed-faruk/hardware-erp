import { err, ok, type Result } from './result';

export type Piasters = number;
export type Milli = number;

/** a*b/c rounded half away from zero; all arguments integers, c > 0. Never goes through floats. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c) || c <= 0) {
    throw new RangeError('mulDivRound needs integers and a positive divisor');
  }
  const num = a * b;
  if (!Number.isSafeInteger(num)) throw new RangeError('mulDivRound overflow');
  const sign = num < 0 ? -1 : 1;
  const magnitude = Math.floor((Math.abs(num) * 2 + c) / (2 * c));
  return magnitude === 0 ? 0 : sign * magnitude;
}

function parseScaled(input: string, decimals: number, what: string): Result<number> {
  const pattern = new RegExp(`^(-?)(\\d+)(?:\\.(\\d{1,${decimals}}))?$`);
  const m = pattern.exec(input.trim());
  if (!m) return err('INVALID_NUMBER', `${what}: invalid number`);
  const [, sign, whole = '0', frac = ''] = m;
  const value = Number(whole + frac.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(value)) return err('INVALID_NUMBER', `${what}: too large`);
  return ok(sign === '-' ? -value : value);
}

/** "125.50" -> 12550 piasters. Strings only; no float arithmetic. */
export const toPiasters = (input: string): Result<Piasters> => parseScaled(input, 2, 'money');

/** "2.5" -> 2500 milli-units. */
export const toMilli = (input: string): Result<Milli> => parseScaled(input, 3, 'quantity');

function formatScaled(value: number, decimals: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** 12550 -> "125.50" */
export const formatMoney = (value: Piasters): string => formatScaled(value, 2);

/** 2500 -> "2.5" (trailing zeros trimmed) */
export const formatQty = (value: Milli): string => formatScaled(value, 3).replace(/\.?0+$/, '');
