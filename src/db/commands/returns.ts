import { z } from 'zod';

import { rebuildPartyBalances, rebuildStockBalances } from '../balances';
import { newCommon, type DeviceContext, canCtx } from './context';
import { nowIso, uuidv7 } from '../ids';
import { validateAllocations } from '../allocations';
import { drawerBalance, openShopShift } from '../cash';
import { nextNumber } from '../numbering';
import { loadSoldReturned, postedReturnLines } from '../returnable';
import { enqueue } from '../outbox';
import type { AuditRow, CashMovement, LooseRow, PartyLedgerRow, Payment, StockMovement } from '../types';
import { mulDivRound } from '@/domain/money';
import { err, type Err } from '@/domain/result';
import { allocateRefund, checkFreeReturn, computeReturnLine, type PriorReturn } from '@/domain/returns';

const uuid = z.string().min(1);

export const RETURN_REASONS = ['wrongItem', 'defect', 'changedMind', 'other'] as const;
export const VOID_REASONS = ['mistake', 'customerLeft', 'other'] as const;

const returnInput = z.object({
  originalInvoiceId: uuid.nullable(),
  /** the customer, needed only when no invoice (an invoice already knows it) */
  customerId: uuid.nullable().default(null),
  lines: z
    .array(
      z.object({
        originalLineId: uuid.nullable(),
        productId: uuid.nullable().default(null),
        qtyMilli: z.number().int().positive(),
        /** return without invoice: price per sold unit the manager typed */
        unitRefund: z.number().int().nonnegative().default(0),
        condition: z.enum(['good', 'damaged']),
      }),
    )
    .min(1),
  reason: z.enum(RETURN_REASONS).nullable().default(null),
  shiftId: uuid,
  cashAccountId: uuid,
});
export type ReturnInput = z.input<typeof returnInput>;

export interface PostedDoc {
  ok: true;
  id: string;
  number: string;
  total: number;
  cash: number;
  credit: number;
}

/** RET-01..06: a return by invoice (cashier or manager) or without invoice (manager). One transaction, no network. */
export async function postSalesReturn(ctx: DeviceContext, raw: ReturnInput): Promise<PostedDoc | Err> {
  const parsed = returnInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المرتجع غير صحيحة');
  const input = parsed.data;
  const byInvoice = input.originalInvoiceId !== null;
  if (canCtx(ctx, byInvoice ? 'returnWithInvoice' : 'returnWithoutInvoice') !== 'yes')
    return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const now = nowIso();

  const invoice = byInvoice ? await db.salesInvoices.get(input.originalInvoiceId!) : undefined;
  if (byInvoice && (!invoice || invoice.status !== 'posted'))
    return err('NOT_FOUND', 'الفاتورة مش موجودة أو ملغية');
  const soldLines = invoice ? await db.salesInvoiceLines.where('invoiceId').equals(invoice.id).toArray() : [];
  const prior: PriorReturn[] = invoice
    ? (
        await postedReturnLines(
          db,
          soldLines.map((l) => l.id),
        )
      ).map((r) => ({ originalLineId: r.originalLineId as string, qtyMilli: r.qty as number }))
    : [];
  const warehouses = await db.warehouses.filter((w) => !w.deletedAt).toArray();
  const main = warehouses.find((w) => w.kind === 'main');
  const scrap = warehouses.find((w) => w.kind === 'scrap');
  if (!main || !scrap) return err('NO_WAREHOUSE', 'مفيش مخزن');

  if (!byInvoice) {
    // a return without invoice: every product must have been sold before, and not more than sold - already returned
    if (input.lines.some((l) => !l.productId)) return err('E_VALIDATION', 'الصنف مطلوب');
    const asked = input.lines.map((l) => ({ productId: l.productId as string, qtyMilli: l.qtyMilli }));
    const checked = checkFreeReturn(
      asked,
      await loadSoldReturned(
        db,
        asked.map((l) => l.productId),
      ),
    );
    if (!checked.ok) return checked;
  }

  const returnId = uuidv7();
  const lines: LooseRow[] = [];
  const stock: StockMovement[] = [];
  const taken = new Map<string, number>();
  let total = 0;
  for (const l of input.lines) {
    let net: number;
    let productId = l.productId;
    let unitCost = 0;
    let unitFactor = 1000;
    let unitRefund = l.unitRefund;
    if (byInvoice) {
      const sold = soldLines.find((s) => s.id === l.originalLineId);
      if (!sold) return err('E_VALIDATION', 'سطر مش في الفاتورة');
      const alsoNow = (taken.get(sold.id) ?? 0) as number;
      const r = computeReturnLine(
        {
          id: sold.id,
          qtyMilli: sold.qty,
          finalAmount: sold.netAmount - sold.allocDiscount,
          unitCost: sold.unitCost,
        },
        [...prior, ...(alsoNow ? [{ originalLineId: sold.id, qtyMilli: alsoNow }] : [])],
        l.qtyMilli,
      );
      if (!r.ok) return r;
      taken.set(sold.id, alsoNow + l.qtyMilli);
      net = r.refund;
      productId = sold.productId;
      unitCost = r.unitCost;
      unitFactor = sold.unitFactor;
      unitRefund = mulDivRound(net, 1000, l.qtyMilli);
    } else {
      if (!productId) return err('E_VALIDATION', 'الصنف مطلوب');
      net = mulDivRound(unitRefund, l.qtyMilli, 1000);
    }
    if (!productId) continue;
    const baseQty = mulDivRound(l.qtyMilli, unitFactor, 1000);
    const product = await db.products.get(productId);
    const lineId = uuidv7();
    total += net;
    lines.push({
      ...newCommon(ctx),
      id: lineId,
      returnId,
      originalLineId: l.originalLineId,
      productId,
      qty: l.qtyMilli,
      unitRefund,
      netAmount: net,
      unitCost,
      condition: l.condition,
      warehouseId: l.condition === 'damaged' ? scrap.id : main.id,
    });
    if (product?.type !== 'service')
      stock.push({
        ...newCommon(ctx),
        productId,
        warehouseId: l.condition === 'damaged' ? scrap.id : main.id,
        qty: baseQty,
        unitCost,
        docType: 'sales_return',
        docId: returnId,
        lineId,
        occurredAt: now,
      });
  }
  if (total <= 0) return err('E_VALIDATION', 'قيمة المرتجع صفر');

  const split = invoice
    ? allocateRefund(
        (
          await db.payments.where('[documentType+documentId]').equals(['sales_invoice', invoice.id]).toArray()
        ).map((p) => ({ method: p.method, amount: p.amount })),
        total,
      )
    : ({ ok: true, credit: 0, cash: total } as const);
  if (!split.ok) return split;
  const customerId = invoice?.customerId ?? input.customerId;
  if (split.credit > 0 && !customerId) return err('E_VALIDATION', 'العميل مطلوب');
  if (split.cash > (await drawerBalance(db, input.shiftId)))
    return err('DRAWER_SHORT', 'الدرج مفيهوش فلوس كفاية');

  const row = () => newCommon(ctx);
  const payments: Payment[] = [
    ...(split.cash > 0
      ? [{ method: 'cash' as const, amount: split.cash, cashAccountId: input.cashAccountId }]
      : []),
    ...(split.credit > 0 ? [{ method: 'credit' as const, amount: split.credit, cashAccountId: null }] : []),
  ].map((p) => ({ ...row(), documentType: 'sales_return', documentId: returnId, reference: null, ...p }));
  const cashMovements: CashMovement[] =
    split.cash > 0
      ? [
          {
            ...row(),
            cashAccountId: input.cashAccountId,
            shiftId: input.shiftId,
            amount: -split.cash,
            method: 'cash',
            docType: 'sales_return',
            docId: returnId,
            occurredAt: now,
          },
        ]
      : [];
  const partyLedger: PartyLedgerRow[] =
    split.credit > 0
      ? [
          {
            ...row(),
            partyType: 'customer',
            partyId: customerId!,
            amount: -split.credit,
            docType: 'sales_return',
            docId: returnId,
            occurredAt: now,
          },
        ]
      : [];

  return db.transaction(
    'rw',
    [
      db.salesReturns,
      db.salesReturnLines,
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
    async (): Promise<PostedDoc> => {
      const number = await nextNumber(db, ctx.devicePrefix, 'RET');
      const doc = {
        ...row(),
        id: returnId,
        number,
        issuedAt: now,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        originalInvoiceId: invoice?.id ?? null,
        customerId,
        total,
        refundMethod: split.cash > 0 ? 'cash' : 'credit',
        reason: input.reason,
        approvedBy: null,
      };
      const audit: AuditRow = {
        ...row(),
        action: 'return_posted',
        entity: 'sales_returns',
        entityId: returnId,
        before: null,
        after: { number, total },
        workerId: ctx.workerId,
        approvedBy: null,
        occurredAt: now,
      };
      await db.salesReturns.add(doc);
      await db.salesReturnLines.bulkAdd(lines);
      await db.payments.bulkAdd(payments);
      await db.stockMovements.bulkAdd(stock);
      await db.partyLedger.bulkAdd(partyLedger);
      await db.cashMovements.bulkAdd(cashMovements);
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stock.map((m) => [m.productId, m.warehouseId]),
      );
      if (partyLedger.length) await rebuildPartyBalances(db, [['customer', customerId!]]);
      await enqueue(
        db,
        'salesReturns',
        { ...doc, lines, payments, stockMovements: stock, partyLedger, cashMovements },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, id: returnId, number, total, cash: split.cash, credit: split.credit };
    },
  );
}

/** VOID-02: the manager cancels a finished invoice; every stock, customer and cash row is reversed exactly. */
export async function voidInvoice(
  ctx: DeviceContext,
  input: { invoiceId: string; reason: (typeof VOID_REASONS)[number]; shiftId: string | null },
): Promise<{ ok: true; id: string; number: string } | Err> {
  if (canCtx(ctx, 'void') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (!VOID_REASONS.includes(input.reason)) return err('E_VALIDATION', 'السبب مطلوب');
  const { db } = ctx;
  const invoice = await db.salesInvoices.get(input.invoiceId);
  if (!invoice) return err('NOT_FOUND', 'الفاتورة مش موجودة');
  if (invoice.status !== 'posted') return err('ALREADY_VOIDED', 'الفاتورة ملغية');
  // a voided return does not count: its goods and money are already reversed
  if (
    (await db.salesReturns.where('originalInvoiceId').equals(invoice.id).toArray()).some(
      (r) => r.status === 'posted',
    )
  )
    return err('HAS_RETURNS', 'الفاتورة عليها مرتجع');
  const voidId = uuidv7();
  const now = nowIso();
  const [stock, party, cash] = await Promise.all([
    db.stockMovements.where('docId').equals(invoice.id).toArray(),
    db.partyLedger.where('docId').equals(invoice.id).toArray(),
    db.cashMovements.where('docId').equals(invoice.id).toArray(),
  ]);
  // the cash share goes back out of the drawer of the shift open on this device now, whatever the age or device of the invoice
  const shift = cash.length > 0 ? await openShopShift(db) : null;
  if (cash.length > 0 && !shift) return err('NO_SHIFT', 'افتح وردية الأول');
  const stockMovements: StockMovement[] = stock.map((m) => ({
    ...newCommon(ctx),
    productId: m.productId,
    warehouseId: m.warehouseId,
    qty: -m.qty,
    unitCost: m.unitCost,
    docType: 'void',
    docId: voidId,
    lineId: null,
    occurredAt: now,
  }));
  const partyLedger: PartyLedgerRow[] = party.map((m) => ({
    ...newCommon(ctx),
    partyType: m.partyType,
    partyId: m.partyId,
    amount: -m.amount,
    docType: 'void',
    docId: voidId,
    occurredAt: now,
  }));
  const cashMovements: CashMovement[] = cash.map((m) => ({
    ...newCommon(ctx),
    cashAccountId: shift!.cashAccountId as string,
    shiftId: shift!.id,
    amount: -m.amount,
    method: m.method,
    docType: 'void',
    docId: voidId,
    occurredAt: now,
  }));
  return db.transaction(
    'rw',
    [
      db.voids,
      db.salesInvoices,
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
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'VOID');
      const doc = {
        ...newCommon(ctx),
        id: voidId,
        number,
        issuedAt: now,
        workerId: ctx.workerId,
        shiftId: shift?.id ?? input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        targetType: 'sales_invoice',
        targetId: invoice.id,
        reason: input.reason,
        approvedBy: ctx.workerId,
      };
      const audit: AuditRow = {
        ...newCommon(ctx),
        action: 'invoice_voided',
        entity: 'sales_invoices',
        entityId: invoice.id,
        before: null,
        after: { number: invoice.number, reason: input.reason },
        workerId: ctx.workerId,
        approvedBy: null,
        occurredAt: now,
      };
      await db.voids.add(doc);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.partyLedger.bulkAdd(partyLedger);
      await db.cashMovements.bulkAdd(cashMovements);
      await db.salesInvoices.update(invoice.id, { status: 'voided', voidedBy: voidId });
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stockMovements.map((m) => [m.productId, m.warehouseId]),
      );
      if (partyLedger.length)
        await rebuildPartyBalances(
          db,
          partyLedger.map((p) => [p.partyType, p.partyId]),
        );
      await enqueue(db, 'voids', { ...doc, stockMovements, partyLedger, cashMovements }, ctx.workerId);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true as const, id: voidId, number };
    },
  );
}

const receiptInput = z.object({
  customerId: uuid,
  amount: z.number().int().positive(),
  method: z.enum(['cash', 'card', 'instapay', 'wallet', 'other']),
  reference: z.string().max(60).nullable().default(null),
  shiftId: uuid.nullable().default(null),
  cashAccountId: uuid.nullable().default(null),
  /** the credit invoices this collection settles (FIN-06); the rest stays on account */
  allocations: z.array(z.object({ invoice_id: uuid, amount: z.number().int().positive() })).default([]),
});

/** FIN-06 / CUS-03: a customer pays on account. Cash goes into the open drawer; other methods only reduce the debt. */
export async function postCustomerReceipt(
  ctx: DeviceContext,
  raw: z.input<typeof receiptInput>,
): Promise<{ ok: true; id: string; number: string; balanceAfter: number } | Err> {
  const parsed = receiptInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات التحصيل غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'customerReceipt') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.method !== 'cash' && !input.reference) return err('E_VALIDATION', 'المرجع مطلوب');
  if (input.method === 'cash' && !input.cashAccountId) return err('E_VALIDATION', 'مفيش درج');
  const { db } = ctx;
  const customer = await db.customers.get(input.customerId);
  if (!customer || customer.deletedAt) return err('CUSTOMER_NOT_FOUND', 'عميل غير موجود');
  if (!(await validateAllocations(db, 'customer', customer.id, input.amount, input.allocations)))
    return err('E_VALIDATION', 'تخصيص غير صحيح');
  const id = uuidv7();
  const now = nowIso();
  const partyLedger: PartyLedgerRow = {
    ...newCommon(ctx),
    partyType: 'customer',
    partyId: customer.id,
    amount: -input.amount,
    docType: 'customer_receipt',
    docId: id,
    occurredAt: now,
  };
  const cashMovements: CashMovement[] =
    input.method === 'cash'
      ? [
          {
            ...newCommon(ctx),
            cashAccountId: input.cashAccountId!,
            shiftId: input.shiftId,
            amount: input.amount,
            method: 'cash',
            docType: 'customer_receipt',
            docId: id,
            occurredAt: now,
          },
        ]
      : [];
  return db.transaction(
    'rw',
    [
      db.customerReceipts,
      db.partyLedger,
      db.cashMovements,
      db.auditLog,
      db.partyBalances,
      db.numberSequences,
      db.outbox,
      db.syncState,
    ],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'RCV');
      const doc = {
        ...newCommon(ctx),
        id,
        number,
        issuedAt: now,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        customerId: customer.id,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        allocations: input.allocations.length ? input.allocations : null,
      };
      const audit: AuditRow = {
        ...newCommon(ctx),
        action: 'customer_receipt_posted',
        entity: 'customer_receipts',
        entityId: id,
        before: null,
        after: { number, amount: input.amount },
        workerId: ctx.workerId,
        approvedBy: null,
        occurredAt: now,
      };
      await db.customerReceipts.add(doc);
      await db.partyLedger.add(partyLedger);
      await db.cashMovements.bulkAdd(cashMovements);
      await db.auditLog.add(audit);
      await rebuildPartyBalances(db, [['customer', customer.id]]);
      await enqueue(
        db,
        'customerReceipts',
        { ...doc, partyLedger: [partyLedger], cashMovements },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      const balanceAfter = (await db.partyBalances.get(['customer', customer.id]))?.amount ?? 0;
      return { ok: true as const, id, number, balanceAfter };
    },
  );
}

/**
 * The manager cancels a posted sales return (permission voidReturn): the goods leave stock again at the same quantity and
 * cost, a cash refund comes back into the drawer, a credit refund goes back onto the customer's debt. The invoice can be
 * returned again. Cash only goes back into the drawer of the open shift on this device (the one that paid it out).
 */
export async function voidReturn(
  ctx: DeviceContext,
  input: { returnId: string; reason: (typeof VOID_REASONS)[number]; shiftId: string | null },
): Promise<{ ok: true; id: string; number: string } | Err> {
  if (canCtx(ctx, 'voidReturn') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (!VOID_REASONS.includes(input.reason)) return err('E_VALIDATION', 'السبب مطلوب');
  const { db } = ctx;
  const ret = await db.salesReturns.get(input.returnId);
  if (!ret) return err('NOT_FOUND', 'المرتجع مش موجود');
  if (ret.status !== 'posted') return err('ALREADY_VOIDED', 'المرتجع ملغي');
  const voidId = uuidv7();
  const now = nowIso();
  const [stock, party, cash] = await Promise.all([
    db.stockMovements.where('docId').equals(ret.id).toArray(),
    db.partyLedger.where('docId').equals(ret.id).toArray(),
    db.cashMovements.where('docId').equals(ret.id).toArray(),
  ]);
  if (cash.length > 0) {
    const shift = input.shiftId ? await db.shifts.get(input.shiftId) : undefined;
    if (!shift || shift.status !== 'open') return err('NO_SHIFT', 'افتح وردية الأول');
    if (cash.some((m) => m.cashAccountId !== shift.cashAccountId))
      return err('WRONG_DRAWER', 'الإلغاء من الجهاز اللي صرف المرتجع');
  }
  const stockMovements: StockMovement[] = stock.map((m) => ({
    ...newCommon(ctx),
    productId: m.productId,
    warehouseId: m.warehouseId,
    qty: -m.qty,
    unitCost: m.unitCost,
    docType: 'void',
    docId: voidId,
    lineId: null,
    occurredAt: now,
  }));
  const partyLedger: PartyLedgerRow[] = party.map((m) => ({
    ...newCommon(ctx),
    partyType: m.partyType,
    partyId: m.partyId,
    amount: -m.amount,
    docType: 'void',
    docId: voidId,
    occurredAt: now,
  }));
  const cashMovements: CashMovement[] = cash.map((m) => ({
    ...newCommon(ctx),
    cashAccountId: m.cashAccountId,
    shiftId: input.shiftId,
    amount: -m.amount,
    method: m.method,
    docType: 'void',
    docId: voidId,
    occurredAt: now,
  }));
  return db.transaction(
    'rw',
    [
      db.voids,
      db.salesReturns,
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
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'VOID');
      const doc = {
        ...newCommon(ctx),
        id: voidId,
        number,
        issuedAt: now,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        targetType: 'sales_return',
        targetId: ret.id,
        reason: input.reason,
        approvedBy: ctx.workerId,
      };
      const audit: AuditRow = {
        ...newCommon(ctx),
        action: 'return_voided',
        entity: 'sales_returns',
        entityId: ret.id,
        before: null,
        after: { number: ret.number, reason: input.reason },
        workerId: ctx.workerId,
        approvedBy: null,
        occurredAt: now,
      };
      await db.voids.add(doc);
      await db.stockMovements.bulkAdd(stockMovements);
      await db.partyLedger.bulkAdd(partyLedger);
      await db.cashMovements.bulkAdd(cashMovements);
      await db.salesReturns.update(ret.id, { status: 'voided', voidedBy: voidId });
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stockMovements.map((m) => [m.productId, m.warehouseId]),
      );
      if (partyLedger.length)
        await rebuildPartyBalances(
          db,
          partyLedger.map((p) => [p.partyType, p.partyId]),
        );
      await enqueue(db, 'voids', { ...doc, stockMovements, partyLedger, cashMovements }, ctx.workerId);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true as const, id: voidId, number };
    },
  );
}
