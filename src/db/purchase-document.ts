import type { HanafyDB } from './schema';

export interface PurchaseDocumentData {
  shopName: string;
  number: string;
  issuedAt: string;
  supplierName: string;
  lines: { name: string; qtyMilli: number; unitCost: number; net: number }[];
  total: number;
  payments: { method: string; amount: number }[];
}

/** Everything the A4 purchase invoice prints, read back from the saved document. */
export async function loadPurchaseDocument(
  db: HanafyDB,
  invoiceId: string,
): Promise<PurchaseDocumentData | null> {
  const inv = await db.purchaseInvoices.get(invoiceId);
  if (!inv) return null;
  const [lines, payments, company, supplier] = await Promise.all([
    db.purchaseInvoiceLines.where('invoiceId').equals(invoiceId).toArray(),
    db.payments.where('[documentType+documentId]').equals(['purchase_invoice', invoiceId]).toArray(),
    db.companies.toCollection().first(),
    db.suppliers.get(inv.supplierId as string),
  ]);
  const products = await db.products.bulkGet(lines.map((l) => (l.productId as string | null) ?? ''));
  return {
    shopName: company?.name ?? '',
    number: inv.number,
    issuedAt: inv.issuedAt,
    supplierName: supplier?.name ?? '',
    lines: lines.map((l, i) => ({
      name: products[i]?.name ?? '',
      qtyMilli: l.qty as number,
      unitCost: l.unitCost as number,
      net: l.netAmount as number,
    })),
    total: inv.total as number,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
  };
}
