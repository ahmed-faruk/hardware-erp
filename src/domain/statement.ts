import { cairoDaysBetween } from './returnWindow';
import type { Piasters } from './money';

export interface LedgerRow {
  id: string;
  occurredAt: string;
  /** + the party owes us (customer) / - we owe the party */
  amount: Piasters;
  docNumber: string;
  /** the document this row belongs to; a payment's `allocations` name the invoices (by this id) it settles */
  docId?: string;
  allocations?: { docId: string; amount: Piasters }[];
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

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const cairoDate = (iso: string): string => DATE_FORMAT.format(new Date(iso));

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

  // explicit allocations settle the named invoices first; whatever was paid beyond that settles the oldest debt first
  const debits = upTo.filter((x) => x.amount > 0);
  const left = new Map(debits.map((r) => [r.id, r.amount]));
  const byDoc = new Map(debits.filter((r) => r.docId).map((r) => [r.docId as string, r]));
  let explicit = 0;
  for (const pay of upTo.filter((x) => x.amount < 0))
    for (const a of pay.allocations ?? []) {
      const target = byDoc.get(a.docId);
      if (!target) continue;
      const take = Math.min(a.amount, left.get(target.id) ?? 0);
      left.set(target.id, (left.get(target.id) ?? 0) - take);
      explicit += take;
    }
  let paid = -upTo.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0) - explicit;
  const aging: Aging = { d0to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  for (const r of debits) {
    const remaining = left.get(r.id) ?? 0;
    const used = Math.min(Math.max(paid, 0), remaining);
    paid -= used;
    const open = remaining - used;
    if (open === 0) continue;
    const days = cairoDaysBetween(r.occurredAt, now);
    const key = days <= 30 ? 'd0to30' : days <= 60 ? 'd31to60' : days <= 90 ? 'd61to90' : 'd90plus';
    aging[key] += open;
  }
  return { opening, rows, closing: running, aging };
}
