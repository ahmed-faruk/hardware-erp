import { cairoDaysBetween } from './returnWindow';
import type { Piasters } from './money';

export interface LedgerRow {
  id: string;
  occurredAt: string;
  /** + the party owes us (customer) / - we owe the party */
  amount: Piasters;
  docNumber: string;
}

export interface Aging {
  d0to30: Piasters;
  d31to60: Piasters;
  d61to90: Piasters;
  d90plus: Piasters;
}

export interface Statement {
  opening: Piasters;
  rows: (LedgerRow & { balance: Piasters })[];
  closing: Piasters;
  /** open debt by age; payments settle the oldest debt first (CUS-04, PUR-07) */
  aging: Aging;
}

const cairoDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso));

/** `period` are Cairo calendar dates (yyyy-mm-dd), both inclusive. Aging always covers the whole history up to `period.to`. */
export function buildStatement(
  all: LedgerRow[],
  period: { from: string; to: string },
  now: string,
): Statement {
  const sorted = [...all].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );
  const upTo = sorted.filter((r) => cairoDate(r.occurredAt) <= period.to);
  const before = upTo.filter((r) => cairoDate(r.occurredAt) < period.from);
  const opening = before.reduce((a, r) => a + r.amount, 0);
  let running = opening;
  const rows = upTo
    .filter((r) => cairoDate(r.occurredAt) >= period.from)
    .map((r) => ({ ...r, balance: (running += r.amount) }));

  // settle the oldest debt first with everything paid so far
  let paid = -upTo.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0);
  const aging: Aging = { d0to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  for (const r of upTo.filter((x) => x.amount > 0)) {
    const used = Math.min(paid, r.amount);
    paid -= used;
    const open = r.amount - used;
    if (open === 0) continue;
    const days = cairoDaysBetween(r.occurredAt, now);
    const key = days <= 30 ? 'd0to30' : days <= 60 ? 'd31to60' : days <= 90 ? 'd61to90' : 'd90plus';
    aging[key] += open;
  }
  return { opening, rows, closing: running, aging };
}
