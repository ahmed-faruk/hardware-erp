// Pure parsing helpers for the OpenSourcePOS browser export (docs: skill ospos-migration, reference.md §2, §4, §5).
import { createHash } from 'node:crypto';

/** Fixed namespace so ids are stable across runs: re-importing never duplicates a row. */
export const NAMESPACE = '6f1f7c52-9a43-4d6e-8b1a-3c0e5d2a7b19';

/** UUID v5 (SHA-1, RFC 4122) of `name` inside `namespace`. */
export function uuid5(name: string, namespace: string = NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const legacyId = (kind: string, id: string | number): string => uuid5(`ospos:${kind}:${id}`);

/** a * b / c rounded half away from zero, integers only. */
export function mulDivRound(a: number, b: number, c: number): number {
  const num = a * b;
  const magnitude = Math.floor((Math.abs(num) * 2 + c) / (2 * c));
  return magnitude === 0 ? 0 : (num < 0 ? -1 : 1) * magnitude;
}

function decimalToScaled(digits: string, scale: number): number {
  const [whole = '0', frac = ''] = digits.replace(/,/g, '').split('.');
  const padded = (frac + '0'.repeat(scale + 1)).slice(0, scale + 1); // keep one extra digit to round half up
  const scaled =
    Number(whole) * 10 ** scale + Math.floor(Number(padded) / 10) + (Number(padded.slice(-1)) >= 5 ? 1 : 0);
  return scaled;
}

/** `"EGP 1,234.50"`, `"-EGP 5.00"`, `"EGP -5.00"` -> piasters (sign kept). null when it is not money. */
export function parseMoney(text: string): number | null {
  const m = /^(-?)\s*(?:EGP\s*)?(-?)\s*([\d,]*\.?\d+)$/.exec(String(text).trim());
  if (!m || !/EGP|^[\d.,-]/.test(String(text).trim())) return null;
  const value = decimalToScaled(m[3] ?? '0', 2);
  return m[1] || m[2] ? -value : value;
}

/** `"76.00"`, `"1.00 [stock]"`, `"2.00 x 12.00"` (packs x units) -> milli-units (sign kept). null when invalid. */
export function parseQty(text: string): number | null {
  const clean = String(text)
    .replace(/\[[^\]]*\]/g, '')
    .trim();
  const pack = /^(-?[\d.,]+)\s*x\s*([\d.,]+)$/i.exec(clean);
  if (pack) {
    const packs = decimalToScaled((pack[1] ?? '').replace('-', ''), 3);
    const units = decimalToScaled(pack[2] ?? '', 3);
    const total = mulDivRound(packs, units, 1000);
    return clean.startsWith('-') ? -total : total;
  }
  const m = /^(-?)([\d,]*\.?\d+)$/.exec(clean);
  if (!m) return null;
  const value = decimalToScaled(m[2] ?? '0', 3);
  return m[1] ? -value : value;
}

export type ParsedDiscount =
  { kind: 'none' } | { kind: 'percentBp'; bp: number } | { kind: 'fixed'; piasters: number };

/** `"10.00%"` -> basis points, `"EGP 5.00"` -> piasters. */
export function parseDiscount(text: string): ParsedDiscount | null {
  const t = String(text ?? '').trim();
  if (t === '') return { kind: 'none' };
  const pct = /^(-?[\d.,]+)\s*%$/.exec(t);
  if (pct) {
    const bp = decimalToScaled((pct[1] ?? '').replace('-', ''), 2);
    return bp === 0 ? { kind: 'none' } : { kind: 'percentBp', bp };
  }
  const money = parseMoney(t);
  if (money === null) return null;
  return money === 0 ? { kind: 'none' } : { kind: 'fixed', piasters: Math.abs(money) };
}

/** Wall-clock time in Africa/Cairo -> ISO instant (handles Egypt's daylight saving through the tz database). */
export function cairoToIso(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const offsetAt = (instant: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - instant;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess).toISOString();
}

/** `"01/09/2026"` (noon, time unknown) or `"13/02/2021 02:17:55 am"` -> ISO instant. null when invalid. */
export function parseDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(
    String(text).trim(),
  );
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[4] === undefined) return cairoToIso(y, mo, d, 12, 0, 0);
  let h = Number(m[4]);
  const ap = m[7]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return cairoToIso(y, mo, d, h, Number(m[5]), Number(m[6] ?? 0));
}

/** Arabic matching form: alef variants, ya, ta marbuta, spaces. For matching only, never for stored text. */
export const normalizeArabic = (s: string): string =>
  String(s ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanText = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export type PayMethod = 'cash' | 'credit' | 'card' | 'instapay' | 'wallet' | 'other';

const LABELS: [RegExp, PayMethod][] = [
  [/^(نقدى|نقدي|cash)$/i, 'cash'],
  [/^(مستحق|due)$/i, 'credit'],
  [/^(بطاقة إئتمانية|بطاقة ائتمانية|بطاقة خصم|credit card|debit card)$/i, 'card'],
];
export function mapPaymentLabel(label: string): { method: PayMethod; known: boolean } {
  const t = cleanText(label);
  for (const [re, method] of LABELS) if (re.test(t)) return { method, known: true };
  return { method: 'other', known: false };
}

export interface PaymentPart {
  label: string;
  method: PayMethod;
  known: boolean;
  amount: number;
}

/** Sales: `"نقدى 590.00, مستحق 100.00"` -> parts (last token of each part is the amount). Empty string -> []. */
export function parseSalePayments(text: string): PaymentPart[] {
  const parts: PaymentPart[] = [];
  for (const raw of String(text ?? '').split(/,\s+/)) {
    const m = /^(.*?)\s*(-?[\d,]+\.\d{2})$/.exec(raw.trim());
    if (!m || cleanText(m[1]) === '') continue;
    const amount = parseMoney(m[2] ?? '');
    if (amount === null) continue;
    parts.push({ label: cleanText(m[1]), ...mapPaymentLabel(m[1] ?? ''), amount });
  }
  return parts;
}
