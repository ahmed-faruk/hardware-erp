import { buildReceipt, type ReceiptData, type ReceiptKind } from '@/domain/receipt';
import { err, ok, type Result } from '@/domain/result';

import { newCommon, type DeviceContext, canCtx } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import type { HanafyDB } from '../schema';
import { loadDeviceSettings, loadSettings } from '../settings';
import type { AuditRow } from '../types';

/** Everything a receipt prints, read back from the saved invoice (so a reprint is identical to the original). */
export async function loadReceipt(
  db: HanafyDB,
  invoiceId: string,
  copy: boolean,
  kind: ReceiptKind = 'sale',
): Promise<Result<ReceiptData>> {
  const invoice = await db.salesInvoices.get(invoiceId);
  if (!invoice) return err('NOT_FOUND', 'الفاتورة مش موجودة');
  const [lines, payments, company, settings, device, worker] = await Promise.all([
    db.salesInvoiceLines.where('invoiceId').equals(invoiceId).sortBy('lineNo'),
    db.payments.where('[documentType+documentId]').equals(['sales_invoice', invoiceId]).toArray(),
    db.companies.toCollection().first(),
    loadSettings(db),
    loadDeviceSettings(db),
    invoice.workerId ? db.workers.get(invoice.workerId) : Promise.resolve(undefined),
  ]);
  const products = await db.products.bulkGet(lines.map((l) => l.productId ?? ''));
  let customer = null;
  if (invoice.customerId) {
    const c = await db.customers.get(invoice.customerId);
    const before = (
      await db.partyLedger.where('[partyType+partyId]').equals(['customer', invoice.customerId]).toArray()
    )
      .filter((r) => r.docId !== invoice.id && r.occurredAt <= invoice.issuedAt)
      .reduce((a, r) => a + r.amount, 0);
    if (c) customer = { name: c.name, balanceBefore: before };
  }
  return ok(
    buildReceipt({
      shop: {
        name: company?.name ?? '',
        phone: settings.phone,
        address: settings.address,
        footer: settings.footer,
      },
      invoice: {
        number: invoice.number,
        issuedAt: invoice.issuedAt,
        total: invoice.total,
        invoiceDiscount: invoice.invoiceDiscount,
        cashTendered: invoice.cashTendered,
        changeDue: invoice.changeDue,
      },
      cashierName: worker?.name ?? '',
      lines: lines.map((l, i) => ({
        name: products[i]?.name ?? l.legacyText ?? '',
        qtyMilli: l.qty,
        unitPrice: l.unitPrice,
        lineDiscount: l.lineDiscount,
        netAmount: l.netAmount,
        allocDiscount: l.allocDiscount,
      })),
      payments: payments.map((p) => ({
        method: p.method as 'cash',
        amount: p.amount,
        reference: p.reference,
      })),
      customer,
      copy,
      digits: device.digits,
      kind,
    }),
  );
}

/** The paper for a saved return: same layout, "مرتجع" banner, the refund split in the payment rows. */
export async function loadReturnReceipt(
  db: HanafyDB,
  returnId: string,
  copy: boolean,
): Promise<Result<ReceiptData>> {
  const ret = await db.salesReturns.get(returnId);
  if (!ret) return err('NOT_FOUND', 'المرتجع مش موجود');
  const [lines, payments, company, settings, device, worker] = await Promise.all([
    db.salesReturnLines.where('returnId').equals(returnId).toArray(),
    db.payments.where('[documentType+documentId]').equals(['sales_return', returnId]).toArray(),
    db.companies.toCollection().first(),
    loadSettings(db),
    loadDeviceSettings(db),
    ret.workerId ? db.workers.get(ret.workerId) : Promise.resolve(undefined),
  ]);
  const products = await db.products.bulkGet(lines.map((l) => (l.productId as string | null) ?? ''));
  const customerId = ret.customerId as string | null;
  let customer = null;
  if (customerId) {
    const c = await db.customers.get(customerId);
    const before = (
      await db.partyLedger.where('[partyType+partyId]').equals(['customer', customerId]).toArray()
    )
      .filter((r) => r.docId !== returnId && r.occurredAt <= ret.issuedAt)
      .reduce((a, r) => a + r.amount, 0);
    if (c) customer = { name: c.name, balanceBefore: before };
  }
  return ok(
    buildReceipt({
      shop: {
        name: company?.name ?? '',
        phone: settings.phone,
        address: settings.address,
        footer: settings.footer,
      },
      invoice: {
        number: ret.number,
        issuedAt: ret.issuedAt,
        total: ret.total as number,
        invoiceDiscount: 0,
        cashTendered: 0,
        changeDue: 0,
      },
      cashierName: worker?.name ?? '',
      lines: lines.map((l, i) => ({
        name: products[i]?.name ?? '',
        qtyMilli: l.qty as number,
        unitPrice: l.unitRefund as number,
        lineDiscount: 0,
        netAmount: l.netAmount as number,
        allocDiscount: 0,
      })),
      payments: payments.map((p) => ({
        method: p.method as 'cash',
        amount: p.amount,
        reference: p.reference,
      })),
      customer,
      copy,
      digits: device.digits,
      kind: 'return',
    }),
  );
}

export interface CollectionSlipData {
  shopName: string;
  number: string;
  at: string;
  customerName: string;
  amount: number;
  method: string;
  balanceAfter: number;
  workerName: string;
  /** the invoices this collection settled (numbers and amounts) */
  allocations: { number: string; amount: number }[];
}

export async function loadCollectionSlip(
  db: HanafyDB,
  receiptId: string,
): Promise<Result<CollectionSlipData>> {
  const r = await db.customerReceipts.get(receiptId);
  if (!r) return err('NOT_FOUND', 'السند مش موجود');
  const [company, customer, worker] = await Promise.all([
    db.companies.toCollection().first(),
    db.customers.get(r.customerId as string),
    r.workerId ? db.workers.get(r.workerId) : Promise.resolve(undefined),
  ]);
  const balanceAfter = (
    await db.partyLedger
      .where('[partyType+partyId]')
      .equals(['customer', r.customerId as string])
      .toArray()
  )
    .filter((x) => x.occurredAt <= r.issuedAt)
    .reduce((a, x) => a + x.amount, 0);
  return ok({
    shopName: company?.name ?? '',
    number: r.number,
    at: r.issuedAt,
    customerName: customer?.name ?? '',
    amount: r.amount as number,
    method: r.method as string,
    balanceAfter,
    workerName: worker?.name ?? '',
    allocations: await Promise.all(
      ((r.allocations as { invoice_id: string; amount: number }[] | null | undefined) ?? []).map(
        async (a) => ({
          number: (await db.salesInvoices.get(a.invoice_id))?.number ?? '',
          amount: a.amount,
        }),
      ),
    ),
  });
}

async function audit(
  ctx: DeviceContext,
  row: Omit<AuditRow, keyof ReturnType<typeof newCommon>>,
): Promise<void> {
  const record: AuditRow = { ...newCommon(ctx), ...row };
  await ctx.db.auditLog.add(record);
  await enqueue(ctx.db, 'auditLog', record, ctx.workerId);
}

/** POS-12: a reprint is allowed for whoever can sell, marked "copy" and written to the audit log. */
export async function reprintInvoice(ctx: DeviceContext, invoiceId: string): Promise<Result<ReceiptData>> {
  if (canCtx(ctx, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const receipt = await loadReceipt(ctx.db, invoiceId, true);
  if (!receipt.ok) return receipt;
  const { db } = ctx;
  await db.transaction('rw', [db.auditLog, db.outbox, db.syncState], () =>
    audit(ctx, {
      action: 'invoice_reprinted',
      entity: 'sales_invoices',
      entityId: invoiceId,
      before: null,
      after: null,
      workerId: ctx.workerId,
      approvedBy: null,
      occurredAt: nowIso(),
    }),
  );
  return receipt;
}

export const NO_SALE_REASONS = ['change', 'wrongChange', 'cashCheck', 'other'] as const;
export type NoSaleReason = (typeof NO_SALE_REASONS)[number];

export interface NoSaleSlipData {
  workerName: string;
  reason: NoSaleReason;
  at: string;
}

/** POS-13: open the drawer without a sale. Whoever has the permission may; the reason is audited. */
export async function noSale(ctx: DeviceContext, reason: NoSaleReason): Promise<Result<NoSaleSlipData>> {
  if (!NO_SALE_REASONS.includes(reason)) return err('E_VALIDATION', 'سبب غير صحيح');
  if (canCtx(ctx, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  if (canCtx(ctx, 'noSaleDrawer') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const at = nowIso();
  await db.transaction('rw', [db.auditLog, db.outbox, db.syncState], () =>
    audit(ctx, {
      action: 'no_sale',
      entity: 'drawer',
      entityId: null,
      before: null,
      after: { reason },
      workerId: ctx.workerId,
      approvedBy: null,
      occurredAt: at,
    }),
  );
  const worker = await db.workers.get(ctx.workerId);
  return ok({ workerName: worker?.name ?? '', reason, at });
}
