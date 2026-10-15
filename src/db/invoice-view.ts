import type { HanafyDB } from './schema';

export type InvoiceKind = 'sale' | 'purchase';

/** Everything the on-screen invoice shows, read back from the saved document (numbers, not text). */
export interface InvoiceView {
  kind: InvoiceKind;
  number: string;
  issuedAt: string;
  /** the customer (sale) or the supplier (purchase); empty when there is none */
  party: string;
  worker: string;
  status: 'posted' | 'voided';
  lines: {
    name: string;
    qtyMilli: number;
    unitPrice: number;
    discount: number;
    total: number;
    returnedMilli: number;
  }[];
  /** the invoice-level discount plus every line discount */
  discount: number;
  total: number;
  payments: { method: string; amount: number; reference: string | null }[];
  returns: { id: string; number: string; total: number }[];
}

/** One saved sales or purchase invoice with its lines, payments and returns. Never carries cost or profit of a sale. */
export async function loadInvoiceView(
  db: HanafyDB,
  kind: InvoiceKind,
  id: string,
): Promise<InvoiceView | null> {
  if (kind === 'sale') {
    const inv = await db.salesInvoices.get(id);
    if (!inv) return null;
    const [lines, payments, returns, worker, customer] = await Promise.all([
      db.salesInvoiceLines.where('invoiceId').equals(id).sortBy('lineNo'),
      db.payments.where('[documentType+documentId]').equals(['sales_invoice', id]).toArray(),
      db.salesReturns.filter((r) => r.originalInvoiceId === id && r.status === 'posted').toArray(),
      inv.workerId ? db.workers.get(inv.workerId) : Promise.resolve(undefined),
      inv.customerId ? db.customers.get(inv.customerId) : Promise.resolve(undefined),
    ]);
    const products = await db.products.bulkGet(lines.map((l) => l.productId ?? ''));
    const returnedLines = await db.salesReturnLines
      .where('originalLineId')
      .anyOf(lines.map((l) => l.id))
      .toArray();
    const goodReturn = new Set(returns.map((r) => r.id));
    return {
      kind,
      number: inv.number,
      issuedAt: inv.issuedAt,
      party: customer?.name ?? '',
      worker: worker?.name ?? '',
      status: inv.status,
      lines: lines.map((l, i) => ({
        name: products[i]?.name ?? l.legacyText ?? '',
        qtyMilli: l.qty,
        unitPrice: l.unitPrice,
        discount: l.lineDiscount + l.allocDiscount,
        total: l.netAmount - l.allocDiscount,
        returnedMilli: returnedLines
          .filter((r) => r.originalLineId === l.id && goodReturn.has(r.returnId as string))
          .reduce((a, r) => a + (r.qty as number), 0),
      })),
      discount: inv.lineDiscountTotal + inv.invoiceDiscount,
      total: inv.total,
      payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
      returns: returns.map((r) => ({ id: r.id, number: r.number as string, total: r.total as number })),
    };
  }
  const inv = await db.purchaseInvoices.get(id);
  if (!inv) return null;
  const [lines, payments, returns, worker, supplier] = await Promise.all([
    db.purchaseInvoiceLines.where('invoiceId').equals(id).toArray(),
    db.payments.where('[documentType+documentId]').equals(['purchase_invoice', id]).toArray(),
    db.purchaseReturns.filter((r) => r.originalInvoiceId === id && r.status === 'posted').toArray(),
    inv.workerId ? db.workers.get(inv.workerId as string) : Promise.resolve(undefined),
    db.suppliers.get(inv.supplierId as string),
  ]);
  const products = await db.products.bulkGet(lines.map((l) => (l.productId as string | null) ?? ''));
  return {
    kind,
    number: inv.number,
    issuedAt: inv.issuedAt,
    party: supplier?.name ?? '',
    worker: worker?.name ?? '',
    status: inv.status === 'voided' ? 'voided' : 'posted',
    lines: lines.map((l, i) => ({
      name: products[i]?.name ?? '',
      qtyMilli: l.qty as number,
      unitPrice: l.unitCost as number,
      discount: (l.discount as number | undefined) ?? 0,
      total: l.netAmount as number,
      returnedMilli: 0,
    })),
    discount: lines.reduce((a, l) => a + ((l.discount as number | undefined) ?? 0), 0),
    total: inv.total as number,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
    returns: returns.map((r) => ({ id: r.id, number: r.number as string, total: r.total as number })),
  };
}
