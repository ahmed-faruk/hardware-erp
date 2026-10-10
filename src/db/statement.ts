import { buildStatement, type LedgerRow, type Statement } from '@/domain/statement';

import type { HanafyDB } from './schema';

/** CUS-04 / PUR-07: the party's ledger rows with their document numbers, shaped by the pure statement builder. */
export async function loadPartyStatement(
  db: HanafyDB,
  partyType: 'customer' | 'supplier',
  partyId: string,
  period: { from: string; to: string },
  now: string = new Date().toISOString(),
): Promise<Statement> {
  const rows = await db.partyLedger.where('[partyType+partyId]').equals([partyType, partyId]).toArray();
  const numberOf = new Map<string, string>();
  const tables = [db.salesInvoices, db.salesReturns, db.customerReceipts, db.voids] as const;
  for (const t of tables)
    for (const d of await t.bulkGet([...new Set(rows.map((r) => r.docId))]))
      if (d) numberOf.set(d.id, d.number);
  const ledger: LedgerRow[] = rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt,
    // a supplier statement reads "what we owe": purchases positive, payments negative, so aging works the same way
    amount: partyType === 'supplier' ? -r.amount : r.amount,
    docNumber: numberOf.get(r.docId) ?? r.docType,
  }));
  return buildStatement(ledger, period, now);
}
