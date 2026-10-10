import { openAmount } from '@/domain/allocations';

import type { HanafyDB } from './schema';

export interface OpenInvoice {
  invoiceId: string;
  number: string;
  issuedAt: string;
  /** the part of the invoice sold or bought on credit that nothing has settled yet */
  open: number;
}

type Alloc = { invoice_id: string; amount: number };

const allocated = (docs: Record<string, unknown>[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const d of docs)
    for (const a of (d.allocations as Alloc[] | null | undefined) ?? [])
      out.set(a.invoice_id, (out.get(a.invoice_id) ?? 0) + a.amount);
  return out;
};

/** FIN-06 / PUR-06: this party's credit invoices that still have something open (new-system invoices on this device only). */
export async function openCreditInvoices(
  db: HanafyDB,
  kind: 'customer' | 'supplier',
  partyId: string,
  ignoreDocId: string | null = null,
): Promise<OpenInvoice[]> {
  const invoices =
    kind === 'customer'
      ? (await db.salesInvoices.where('customerId').equals(partyId).toArray()).map((i) => ({
          id: i.id,
          number: i.number,
          issuedAt: i.issuedAt,
          status: i.status,
          legacy: i.isLegacy,
        }))
      : (await db.purchaseInvoices.where('supplierId').equals(partyId).toArray()).map((i) => ({
          id: i.id,
          number: i.number,
          issuedAt: i.issuedAt,
          status: i.status,
          legacy: i.isLegacy,
        }));
  const docType = kind === 'customer' ? 'sales_invoice' : 'purchase_invoice';
  const settled = allocated(
    (kind === 'customer' ? await db.customerReceipts.toArray() : await db.supplierPayments.toArray()).filter(
      (d) => d.id !== ignoreDocId,
    ),
  );
  const out: OpenInvoice[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'posted' || inv.legacy) continue;
    const credit = (await db.payments.where('[documentType+documentId]').equals([docType, inv.id]).toArray())
      .filter((p) => p.method === 'credit')
      .reduce((a, p) => a + p.amount, 0);
    const open = openAmount(credit, settled.get(inv.id) ?? 0);
    if (open > 0) out.push({ invoiceId: inv.id, number: inv.number, issuedAt: inv.issuedAt, open });
  }
  return out.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
}

/** The same rules the server applies: positive amounts, within the receipt amount, within what is open on each invoice. */
export async function validateAllocations(
  db: HanafyDB,
  kind: 'customer' | 'supplier',
  partyId: string,
  amount: number,
  allocations: Alloc[],
): Promise<boolean> {
  if (allocations.length === 0) return true;
  if (allocations.some((a) => !Number.isInteger(a.amount) || a.amount <= 0)) return false;
  if (allocations.reduce((s, a) => s + a.amount, 0) > amount) return false;
  const open = new Map((await openCreditInvoices(db, kind, partyId)).map((o) => [o.invoiceId, o.open]));
  const mine = new Map<string, number>();
  for (const a of allocations) mine.set(a.invoice_id, (mine.get(a.invoice_id) ?? 0) + a.amount);
  return [...mine].every(([id, sum]) => sum <= (open.get(id) ?? 0));
}
