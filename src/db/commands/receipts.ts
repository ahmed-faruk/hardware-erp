import { buildReceipt, type ReceiptData } from '@/domain/receipt';
import { can } from '@/domain/permissions';
import { err, ok, type Result } from '@/domain/result';

import { newCommon, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import type { HanafyDB } from '../schema';
import { loadDeviceSettings, loadSettings } from '../settings';
import type { AuditRow } from '../types';
import { peekApproval, spendApproval } from './approval';

/** Everything a receipt prints, read back from the saved invoice (so a reprint is identical to the original). */
export async function loadReceipt(
  db: HanafyDB,
  invoiceId: string,
  copy: boolean,
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
    }),
  );
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
  if (can(ctx.role, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
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

/** POS-13: open the drawer without a sale. A cashier needs a manager's PIN; the reason and both people are audited. */
export async function noSale(
  ctx: DeviceContext,
  reason: NoSaleReason,
  approvalToken?: string,
): Promise<Result<NoSaleSlipData>> {
  if (!NO_SALE_REASONS.includes(reason)) return err('E_VALIDATION', 'سبب غير صحيح');
  if (can(ctx.role, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const approval =
    ctx.role === 'manager' ? null : approvalToken ? peekApproval(approvalToken, 'noSaleDrawer') : null;
  if (ctx.role !== 'manager' && !approval) return err('APPROVAL_REQUIRED', 'noSaleDrawer');
  if (approvalToken && approval) spendApproval(approvalToken);
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
      approvedBy: approval?.approvedBy ?? null,
      occurredAt: at,
    }),
  );
  const worker = await db.workers.get(ctx.workerId);
  return ok({ workerName: worker?.name ?? '', reason, at });
}
