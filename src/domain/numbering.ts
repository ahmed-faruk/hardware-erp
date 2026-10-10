export const DOC_TYPES = [
  'INV',
  'RET',
  'RCV',
  'PUR',
  'PRT',
  'PAY',
  'ADJ',
  'EXP',
  'VOID',
  'SHF',
  'XFR',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

const PREFIX = /^[A-Z0-9]{1,4}$/;
const NUMBER = /^([A-Z0-9]{1,4})-([A-Z]{3,4})-(\d{6})$/;

/** `<devicePrefix>-<TYPE>-<seq6>`, e.g. K1-INV-000245. The sequence is allocated by the command, not here. */
export function formatDocNumber(devicePrefix: string, type: DocType, seq: number): string {
  if (!PREFIX.test(devicePrefix)) throw new RangeError('invalid device prefix');
  if (!Number.isInteger(seq) || seq < 1 || seq > 999999) throw new RangeError('sequence out of range');
  return `${devicePrefix}-${type}-${String(seq).padStart(6, '0')}`;
}

export function parseDocNumber(value: string): { devicePrefix: string; type: DocType; seq: number } | null {
  const m = NUMBER.exec(value);
  if (!m) return null;
  const type = DOC_TYPES.find((t) => t === m[2]);
  if (!type) return null;
  return { devicePrefix: m[1] as string, type, seq: Number(m[3]) };
}
