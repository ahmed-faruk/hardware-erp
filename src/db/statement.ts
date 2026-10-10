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
  // receipts and payments that named the invoices they settle
  const named = new Map<string, { docId: string; amount: number }[]>();
  for (const d of [...(await db.customerReceipts.toArray()), ...(await db.supplierPayments.toArray())])
    named.set(
      d.id,
      ((d.allocations as { invoice_id: string; amount: number }[] | null | undefined) ?? []).map((a) => ({
        docId: a.invoice_id,
        amount: a.amount,
      })),
    );
  const ledger: LedgerRow[] = rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt,
    // a supplier statement reads "what we owe": purchases positive, payments negative, so aging works the same way
    amount: partyType === 'supplier' ? -r.amount : r.amount,
    docNumber: numberOf.get(r.docId) ?? r.docType,
    docId: r.docId,
    allocations: named.get(r.docId),
  }));
  return buildStatement(ledger, period, now);
}
