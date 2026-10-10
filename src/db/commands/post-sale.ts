import { rebuildPartyBalances, rebuildStockBalances } from '../balances';
import { newCommon, type DeviceContext } from './context';
import { nowIso, uuidv7 } from '../ids';
import { customerPriceList } from '../pricing';
import { priceFor } from '@/domain/pricing';
import { auditRow } from './audit';
import { negativeAfterSale } from '@/domain/stock';
import { nextNumber } from '../numbering';
import { loadSettings } from '../settings';
import { type Approval, peekApproval, spendApproval } from './approval';
import { enqueue } from '../outbox';
import type {
  AuditRow,
  CashMovement,
  PartyLedgerRow,
  Payment,
  SalesInvoice,
  SalesInvoiceLine,
  StockMovement,
} from '../types';
import { baseQty } from '@/domain/costing';
import { discountNeedsApproval, priceNeedsApproval } from '@/domain/settings';
import type { Action } from '@/domain/permissions';
import { checkCredit } from '@/domain/credit';
import { validatePayments } from '@/domain/payments';
import { can } from '@/domain/permissions';
import { err, type Err } from '@/domain/result';
import { saleInputSchema, type SaleInput } from '@/domain/schemas';
import { computeInvoice } from '@/domain/totals';

export interface SaleReceipt {
  ok: true;
  id: string;
  number: string;
  total: number;
  changeDue: number;
}

/** POS-01..: one sale = one Dexie transaction (document, lines, payments, ledgers, audit, outbox, number). No network. */
export async function postSale(ctx: DeviceContext, raw: SaleInput): Promise<SaleReceipt | Err> {
  const parsed = saleInputSchema.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات الفاتورة غير صحيحة');
  const input = parsed.data;
  if (can(ctx.role, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;

  const products = await db.products.bulkGet(input.lines.map((l) => l.productId));
  const missing = products.findIndex((p) => !p || !p.active || p.deletedAt);
  if (missing !== -1) return err('PRODUCT_NOT_FOUND', 'صنف غير موجود');

  let invoice;
  try {
    invoice = computeInvoice(
      input.lines.map((l) => ({ qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, discount: l.discount })),
      input.invoiceDiscount,
    );
  } catch {
    return err('INVALID_DISCOUNT', 'خصم غير صحيح');
  }

  const paid = validatePayments(invoice.total, input.payments, input.customerId);
  if (!paid.ok) return paid;

  const baseQtys: number[] = [];
  for (const l of input.lines) {
    const q = baseQty(l.qtyMilli, l.unitFactorMilli);
    if (!q.ok) return q;
    baseQtys.push(q.value);
  }

  // what needs a manager's PIN: a discount or price the settings do not allow this role, or credit above the customer's limit
  const settings = await loadSettings(db);

  // INV-11: would this sale take a product below zero stock? `block` refuses before anything is written
  const negatives = negativeAfterSale(
    await Promise.all(
      input.lines.flatMap((l, i) =>
        products[i]!.type === 'stock'
          ? [
              db.stockBalances.get([l.productId, input.warehouseId]).then((b) => ({
                productId: l.productId,
                before: b?.qty ?? 0,
                sold: baseQtys[i]!,
              })),
            ]
          : [],
      ),
    ),
  );
  if (settings.stockNegativePolicy === 'block' && negatives.length > 0) {
    const first = products.find((p) => p?.id === negatives[0]!.productId);
    return err('NEGATIVE_STOCK', first?.name ?? '');
  }
  const customerList = await customerPriceList(db, input.customerId);
  const needs = new Set<Action>();
  // AUD-02: what the manager's PIN allowed on this sale, written next to it
  const overrides: { action: string; approves: Action; after: unknown }[] = [];
  const units = await db.productUnits.bulkGet(input.lines.map((l) => l.productUnitId ?? ''));
  input.lines.forEach((l, i) => {
    if (discountNeedsApproval(settings, ctx.role, l.discount, invoice.lines[i]!.grossAmount)) {
      needs.add('discountOverLimit');
      overrides.push({
        action: 'discount_over_limit',
        approves: 'discountOverLimit',
        after: { target: 'line', productId: l.productId, discount: l.discount },
      });
    }
    const u = units[i];
    const listPrice = priceFor(
      products[i]!,
      u
        ? { factor: u.factor, price: u.price }
        : l.unitFactorMilli !== 1000
          ? { factor: l.unitFactorMilli, price: null }
          : null,
      customerList,
    );
    if (priceNeedsApproval(settings, ctx.role, l.unitPrice, listPrice)) {
      needs.add('priceOverride');
      overrides.push({
        action: 'price_override',
        approves: 'priceOverride',
        after: { productId: l.productId, listPrice, price: l.unitPrice },
      });
    }
  });
  const netSum = invoice.lines.reduce((a, l) => a + l.netAmount, 0);
  if (discountNeedsApproval(settings, ctx.role, input.invoiceDiscount ?? undefined, netSum)) {
    needs.add('discountOverLimit');
    overrides.push({
      action: 'discount_over_limit',
      approves: 'discountOverLimit',
      after: { target: 'invoice', discount: input.invoiceDiscount },
    });
  }

  const creditTotal = input.payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0);
  if (creditTotal > 0 && input.customerId) {
    const customer = await db.customers.get(input.customerId);
    if (!customer || customer.deletedAt) return err('CUSTOMER_NOT_FOUND', 'عميل غير موجود');
    const balance = (await db.partyBalances.get(['customer', customer.id]))?.amount ?? 0;
    const check = checkCredit(
      { creditLimit: customer.creditLimit, lastSyncedBalance: balance, unsyncedCredit: 0 },
      creditTotal,
      input.creditPolicy,
      input.isOffline,
    );
    if (!check.ok && ctx.role !== 'manager') needs.add('creditOverLimit');
  }

  const approvals: { token: string; approval: Approval }[] = [];
  for (const action of needs) {
    const token = input.approvalTokens.find((t) => peekApproval(t, action));
    const approval = token ? peekApproval(token, action) : null;
    if (!token || !approval) return err('APPROVAL_REQUIRED', action);
    approvals.push({ token, approval });
  }

  for (const a of approvals) spendApproval(a.token);
  const issuedAt = nowIso();
  const invoiceId = uuidv7();
  const cashShare = input.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
  const tendered = input.payments.reduce(
    (a, p) => a + (p.method === 'cash' ? (p.tendered ?? p.amount) : 0),
    0,
  );
  const row = (): ReturnType<typeof newCommon> => newCommon(ctx);

  const lines: SalesInvoiceLine[] = input.lines.map((l, i) => {
    const r = invoice.lines[i]!;
    const product = products[i]!;
    return {
      ...row(),
      invoiceId,
      lineNo: i + 1,
      productId: l.productId,
      productUnitId: l.productUnitId ?? null,
      unitFactor: l.unitFactorMilli,
      qty: l.qtyMilli,
      unitPrice: l.unitPrice,
      lineDiscount: r.discount,
      allocDiscount: r.allocatedInvoiceDiscount,
      taxAmount: 0,
      netAmount: r.netAmount,
      unitCost: product.unitCost ?? 0, // cashier devices never receive costs; the server fills it in
      warehouseId: input.warehouseId,
      legacyText: null,
    };
  });
  const payments: Payment[] = input.payments.map((p) => ({
    ...row(),
    documentType: 'sales_invoice',
    documentId: invoiceId,
    method: p.method,
    amount: p.amount,
    reference: p.reference ?? null,
    cashAccountId: p.method === 'cash' ? input.cashAccountId : null,
  }));
  const stockMovements: StockMovement[] = lines.flatMap((line, i) =>
    products[i]!.type === 'stock'
      ? [
          {
            ...row(),
            productId: line.productId!,
            warehouseId: input.warehouseId,
            qty: -baseQtys[i]!,
            unitCost: line.unitCost,
            docType: 'sales_invoice',
            docId: invoiceId,
            lineId: line.id,
            occurredAt: issuedAt,
          },
        ]
      : [],
  );
  const partyLedger: PartyLedgerRow[] =
    creditTotal > 0
      ? [
          {
            ...row(),
            partyType: 'customer',
            partyId: input.customerId!,
            amount: creditTotal,
            docType: 'sales_invoice',
            docId: invoiceId,
            occurredAt: issuedAt,
          },
        ]
      : [];
  const cashMovements: CashMovement[] =
    cashShare > 0
      ? [
          {
            ...row(),
            cashAccountId: input.cashAccountId,
            shiftId: input.shiftId,
            amount: cashShare,
            method: 'cash',
            docType: 'sales_invoice',
            docId: invoiceId,
            occurredAt: issuedAt,
          },
        ]
      : [];

  return db.transaction(
    'rw',
    [
      db.salesInvoices,
      db.salesInvoiceLines,
      db.payments,
      db.stockMovements,
      db.partyLedger,
      db.cashMovements,
      db.auditLog,
      db.stockBalances,
      db.partyBalances,
      db.numberSequences,
      db.outbox,
      db.syncState,
    ],
    async (): Promise<SaleReceipt> => {
      const number = await nextNumber(db, ctx.devicePrefix, 'INV');
      const doc: SalesInvoice = {
        ...newCommon(ctx),
        id: invoiceId,
        number,
        issuedAt,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted',
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        customerId: input.customerId,
        warehouseId: input.warehouseId,
        subtotal: invoice.lines.reduce((a, l) => a + l.grossAmount, 0),
        lineDiscountTotal: invoice.lines.reduce((a, l) => a + l.discount, 0),
        invoiceDiscount: invoice.invoiceDiscount,
        taxTotal: 0,
        cashRounding: 0,
        total: invoice.total,
        cashTendered: tendered,
        changeDue: paid.change,
      };
      const audit: AuditRow = {
        ...newCommon(ctx),
        action: 'sale_posted',
        entity: 'sales_invoices',
        entityId: invoiceId,
        before: null,
        after: { number, total: invoice.total },
        workerId: ctx.workerId,
        approvedBy: approvals[0]?.approval.approvedBy ?? null,
        occurredAt: issuedAt,
      };
      await db.salesInvoices.add(doc);
      await db.salesInvoiceLines.bulkAdd(lines);
      await db.payments.bulkAdd(payments);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.partyLedger.bulkAdd(partyLedger);
      await db.cashMovements.bulkAdd(cashMovements);
      await db.auditLog.add(audit);
      if (negatives.length > 0) {
        const extra = auditRow(ctx, 'negative_stock_sale', 'sales_invoices', invoiceId, { lines: negatives });
        await db.auditLog.add(extra);
        await enqueue(db, 'auditLog', extra, ctx.workerId);
      }
      for (const o of overrides) {
        const extra = auditRow(
          ctx,
          o.action,
          'sales_invoices',
          invoiceId,
          o.after,
          approvals.find((a) => a.approval.action === o.approves)?.approval.approvedBy ?? null,
        );
        await db.auditLog.add(extra);
        await enqueue(db, 'auditLog', extra, ctx.workerId);
      }
      await rebuildStockBalances(
        db,
        stockMovements.map((m) => [m.productId, m.warehouseId]),
      );
      if (creditTotal > 0) await rebuildPartyBalances(db, [['customer', input.customerId!]]);
      await enqueue(
        db,
        'salesInvoices',
        { ...doc, lines, payments, stockMovements, partyLedger, cashMovements },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, id: invoiceId, number, total: invoice.total, changeDue: paid.change };
    },
  );
}
