import { z } from 'zod';

import { validateAllocations } from '../allocations';
import { rebuildPartyBalances, rebuildStockBalances } from '../balances';
import { approvalRole, canCtx, newCommon, type DeviceContext } from './context';
import { nowIso, uuidv7 } from '../ids';
import { nextNumber } from '../numbering';
import { enqueue } from '../outbox';
import { loadSettings } from '../settings';
import { peekApproval, spendApproval } from './approval';
import { upsertRow } from './save-master';
import type {
  AuditRow,
  CashMovement,
  LooseRow,
  PartyLedgerRow,
  Payment,
  Product,
  StockMovement,
} from '../types';
import {
  adjustmentNeedsApproval,
  adjustmentValue,
  ADJUSTMENT_REASONS,
  reasonFitsDelta,
} from '@/domain/adjustment';
import { baseQty, movingAverage } from '@/domain/costing';
import { mulDivRound } from '@/domain/money';
import { computePurchase, costPerBase } from '@/domain/purchase';
import { err, type Err } from '@/domain/result';
import { computeReturnLine, type PriorReturn } from '@/domain/returns';

const id = z.string().min(1);
const PAY_METHODS = ['cash', 'credit', 'card', 'instapay', 'wallet', 'other', 'owner'] as const;
const payment = z.object({
  method: z.enum(PAY_METHODS),
  amount: z.number().int().positive(),
  reference: z.string().max(60).nullable().default(null),
  cashAccountId: id.nullable().default(null),
});

export interface PostedPurchaseDoc {
  ok: true;
  id: string;
  number: string;
  total: number;
}

const auditRow = (
  ctx: DeviceContext,
  action: string,
  entity: string,
  entityId: string,
  after: unknown,
  at: string,
  approvedBy: string | null = null,
): AuditRow => ({
  ...newCommon(ctx),
  action,
  entity,
  entityId,
  before: null,
  after,
  workerId: ctx.workerId,
  approvedBy,
  occurredAt: at,
});

/** The ledger and cash rows that go with a document's payments; `sign` is +1 when money/credit comes in, -1 when it goes out. */
function paymentRows(
  ctx: DeviceContext,
  docType: string,
  docId: string,
  supplierId: string,
  pays: z.infer<typeof payment>[],
  sign: 1 | -1,
  at: string,
): { payments: Payment[]; ledger: PartyLedgerRow[]; cash: CashMovement[] } {
  const payments: Payment[] = pays.map((p) => ({
    ...newCommon(ctx),
    documentType: docType,
    documentId: docId,
    method: p.method,
    amount: p.amount,
    reference: p.reference,
    cashAccountId: p.method === 'cash' ? p.cashAccountId : null,
  }));
  const credit = pays.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0);
  const ledger: PartyLedgerRow[] =
    credit > 0
      ? [
          {
            ...newCommon(ctx),
            partyType: 'supplier',
            partyId: supplierId,
            amount: sign * credit,
            docType,
            docId,
            occurredAt: at,
          },
        ]
      : [];
  const cash: CashMovement[] = pays
    .filter((p) => p.method === 'cash')
    .map((p) => ({
      ...newCommon(ctx),
      cashAccountId: p.cashAccountId!,
      shiftId: null,
      amount: sign * p.amount,
      method: 'cash',
      docType,
      docId,
      occurredAt: at,
    }));
  return { payments, ledger, cash };
}

const checkPays = (pays: z.infer<typeof payment>[], total: number): Err | null => {
  if (pays.reduce((a, p) => a + p.amount, 0) !== total)
    return err('PAYMENT_MISMATCH', 'المدفوع لا يساوي الإجمالي');
  if (pays.some((p) => p.method === 'cash' && !p.cashAccountId)) return err('E_VALIDATION', 'اختار الخزنة');
  if (
    pays.some(
      (p) => (p.method === 'card' || p.method === 'instapay' || p.method === 'wallet') && !p.reference,
    )
  )
    return err('E_VALIDATION', 'المرجع مطلوب');
  return null;
};

const purchaseInput = z.object({
  supplierId: id,
  warehouseId: id,
  supplierRef: z.string().max(60).nullable().default(null),
  lines: z
    .array(
      z.object({
        productId: id,
        productUnitId: id.nullable().default(null),
        unitFactorMilli: z.number().int().positive().default(1000),
        qtyMilli: z.number().int().positive(),
        unitCost: z.number().int().nonnegative(),
        discount: z.number().int().nonnegative().default(0),
        /** a manager may set the new selling price while receiving (per base unit) */
        newSalePrice: z.number().int().positive().nullable().default(null),
      }),
    )
    .min(1),
  payments: z.array(payment).min(1),
});

/** PUR-01..02: receive goods. Stock goes up, the supplier is owed the credit part, cash leaves the chosen account; a manager device also updates the average cost. */
export async function postPurchase(
  ctx: DeviceContext,
  raw: z.input<typeof purchaseInput>,
): Promise<PostedPurchaseDoc | Err> {
  const parsed = purchaseInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات الفاتورة غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'receivePurchase') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.lines.some((l) => l.newSalePrice !== null) && canCtx(ctx, 'editPrices') !== 'yes')
    return err('E_FORBIDDEN', 'السعر للمدير بس');
  if (input.payments.some((p) => p.method === 'owner') && canCtx(ctx, 'payFromOwner') !== 'yes')
    return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const supplier = await db.suppliers.get(input.supplierId);
  if (!supplier || supplier.deletedAt) return err('NOT_FOUND', 'مورد غير موجود');
  const products = await db.products.bulkGet(input.lines.map((l) => l.productId));
  if (products.some((p) => !p || p.deletedAt)) return err('PRODUCT_NOT_FOUND', 'صنف غير موجود');
  let totals;
  try {
    totals = computePurchase(
      input.lines.map((l) => ({ qtyMilli: l.qtyMilli, unitCost: l.unitCost, discount: l.discount })),
    );
  } catch {
    return err('E_VALIDATION', 'قيمة غير صحيحة');
  }
  const bad = checkPays(input.payments, totals.total);
  if (bad) return bad;

  const invoiceId = uuidv7();
  const at = nowIso();
  const lines: LooseRow[] = [];
  const stock: StockMovement[] = [];
  const costs: { product: Product; avg: number }[] = [];
  const running = new Map<string, number>();
  for (const [i, l] of input.lines.entries()) {
    const product = products[i]!;
    const base = baseQty(l.qtyMilli, l.unitFactorMilli);
    if (!base.ok) return base;
    const net = totals.lines[i]!.netAmount;
    const lineId = uuidv7();
    lines.push({
      ...newCommon(ctx),
      id: lineId,
      invoiceId,
      lineNo: i + 1,
      productId: product.id,
      productUnitId: l.productUnitId,
      unitFactor: l.unitFactorMilli,
      qty: l.qtyMilli,
      unitCost: l.unitCost,
      discount: l.discount,
      netAmount: net,
      legacyText: null,
    });
    if (product.type !== 'stock') continue;
    const cost = costPerBase(net, base.value);
    stock.push({
      ...newCommon(ctx),
      productId: product.id,
      warehouseId: input.warehouseId,
      qty: base.value,
      unitCost: cost,
      docType: 'purchase_invoice',
      docId: invoiceId,
      lineId,
      occurredAt: at,
    });
    if (ctx.role === 'manager') {
      const onHand =
        running.get(product.id) ??
        (await db.stockBalances.toArray())
          .filter((b) => b.productId === product.id)
          .reduce((a, b) => a + b.qty, 0);
      const prev = costs.findLast((c) => c.product.id === product.id)?.avg ?? product.unitCost;
      const avg = movingAverage({ oldQtyMilli: onHand, oldAvg: prev, inQtyMilli: base.value, inCost: cost });
      running.set(product.id, onHand + base.value);
      costs.push({ product, avg });
    }
  }
  const { payments, ledger, cash } = paymentRows(
    ctx,
    'purchase_invoice',
    invoiceId,
    supplier.id,
    input.payments,
    -1,
    at,
  );

  return db.transaction(
    'rw',
    [
      db.purchaseInvoices,
      db.purchaseInvoiceLines,
      db.payments,
      db.stockMovements,
      db.partyLedger,
      db.cashMovements,
      db.auditLog,
      db.stockBalances,
      db.partyBalances,
      db.products,
      db.numberSequences,
      db.outbox,
      db.syncState,
    ],
    async (): Promise<PostedPurchaseDoc> => {
      const number = await nextNumber(db, ctx.devicePrefix, 'PUR');
      const doc = {
        ...newCommon(ctx),
        id: invoiceId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        supplierId: supplier.id,
        supplierRef: input.supplierRef,
        warehouseId: input.warehouseId,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
      };
      const audit = auditRow(
        ctx,
        'purchase_posted',
        'purchase_invoices',
        invoiceId,
        { number, total: totals.total },
        at,
      );
      await db.purchaseInvoices.add(doc);
      await db.purchaseInvoiceLines.bulkAdd(lines);
      await db.payments.bulkAdd(payments);
      await db.stockMovements.bulkAdd(stock);
      await db.partyLedger.bulkAdd(ledger);
      await db.cashMovements.bulkAdd(cash);
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stock.map((m) => [m.productId, m.warehouseId]),
      );
      if (ledger.length) await rebuildPartyBalances(db, [['supplier', supplier.id]]);
      // the server recomputes the average itself; this local copy only keeps this manager's screens in step until the next pull
      for (const c of costs) await db.products.update(c.product.id, { unitCost: c.avg });
      for (const l of input.lines)
        if (l.newSalePrice !== null) {
          const r = await upsertRow<Product>(
            ctx,
            'products',
            db.products,
            { id: l.productId, fields: {} },
            { price: l.newSalePrice },
            () => {
              throw new Error('product vanished');
            },
          );
          if (!r.ok) throw new Error(r.code);
        }
      await enqueue(
        db,
        'purchaseInvoices',
        { ...doc, lines, payments, stockMovements: stock, partyLedger: ledger, cashMovements: cash },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, id: invoiceId, number, total: totals.total };
    },
  );
}

const purchaseReturnInput = z.object({
  supplierId: id,
  originalInvoiceId: id.nullable(),
  warehouseId: id,
  lines: z
    .array(
      z.object({
        originalLineId: id.nullable(),
        productId: id.nullable().default(null),
        qtyMilli: z.number().int().positive(),
        /** without an invoice: what the supplier gives back for the line */
        netAmount: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
  /** the refund is one payment of the whole value: off what we owe, or cash back into an account */
  refundTo: z.enum(['credit', 'cash']).default('credit'),
  cashAccountId: id.nullable().default(null),
});

/** A purchase return: goods leave at the cost they came in; the refund lowers what we owe (credit) or comes back as cash. */
export async function postPurchaseReturn(
  ctx: DeviceContext,
  raw: z.input<typeof purchaseReturnInput>,
): Promise<PostedPurchaseDoc | Err> {
  const parsed = purchaseReturnInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المرتجع غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'receivePurchase') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.originalInvoiceId === null && ctx.role !== 'manager')
    return err('E_FORBIDDEN', 'من غير فاتورة للمدير بس');
  const { db } = ctx;
  const supplier = await db.suppliers.get(input.supplierId);
  if (!supplier || supplier.deletedAt) return err('NOT_FOUND', 'مورد غير موجود');
  const soldLines = (
    input.originalInvoiceId
      ? await db.purchaseInvoiceLines.where('invoiceId').equals(input.originalInvoiceId).toArray()
      : []
  ).map((r) => ({
    id: r.id,
    productId: r.productId as string | null,
    qty: r.qty as number,
    unitFactor: r.unitFactor as number,
    unitCost: r.unitCost as number,
    netAmount: r.netAmount as number,
  }));
  const prior: PriorReturn[] = soldLines.length
    ? (
        await db.purchaseReturnLines
          .where('originalLineId')
          .anyOf(soldLines.map((l) => l.id))
          .toArray()
      ).map((r) => ({
        originalLineId: r.originalLineId as string,
        qtyMilli: r.qty as number,
      }))
    : [];
  const returnId = uuidv7();
  const at = nowIso();
  const lines: LooseRow[] = [];
  const stock: StockMovement[] = [];
  const taken = new Map<string, number>();
  let total = 0;
  for (const [i, l] of input.lines.entries()) {
    let net: number;
    let productId = l.productId;
    let unitCost = 0;
    let unitFactor = 1000;
    let costBase: number;
    if (input.originalInvoiceId) {
      const orig = soldLines.find((s) => s.id === l.originalLineId);
      if (!orig) return err('E_VALIDATION', 'سطر مش في الفاتورة');
      const now = taken.get(orig.id) ?? 0;
      const r = computeReturnLine(
        { id: orig.id, qtyMilli: orig.qty, finalAmount: orig.netAmount, unitCost: orig.unitCost },
        [...prior, ...(now ? [{ originalLineId: orig.id, qtyMilli: now }] : [])],
        l.qtyMilli,
      );
      if (!r.ok) return r;
      taken.set(orig.id, now + l.qtyMilli);
      net = r.refund;
      productId = orig.productId;
      unitCost = orig.unitCost;
      unitFactor = orig.unitFactor;
      costBase = costPerBase(orig.netAmount, mulDivRound(orig.qty, orig.unitFactor, 1000));
    } else {
      if (!productId) return err('E_VALIDATION', 'الصنف مطلوب');
      net = l.netAmount;
      costBase = (await db.products.get(productId))?.unitCost ?? 0;
    }
    if (!productId) return err('E_VALIDATION', 'الصنف مطلوب');
    const product = await db.products.get(productId);
    if (!product) return err('PRODUCT_NOT_FOUND', 'صنف غير موجود');
    const base = baseQty(l.qtyMilli, unitFactor);
    if (!base.ok) return base;
    const lineId = uuidv7();
    total += net;
    lines.push({
      ...newCommon(ctx),
      id: lineId,
      returnId,
      lineNo: i + 1,
      originalLineId: l.originalLineId,
      productId,
      productUnitId: null,
      unitFactor,
      qty: l.qtyMilli,
      unitCost,
      discount: 0,
      netAmount: net,
      legacyText: null,
    });
    if (product.type === 'stock')
      stock.push({
        ...newCommon(ctx),
        productId,
        warehouseId: input.warehouseId,
        qty: -base.value,
        unitCost: costBase,
        docType: 'purchase_return',
        docId: returnId,
        lineId,
        occurredAt: at,
      });
  }
  if (total <= 0) return err('E_VALIDATION', 'قيمة المرتجع صفر');
  const refund = [
    input.refundTo === 'cash'
      ? { method: 'cash' as const, amount: total, reference: null, cashAccountId: input.cashAccountId }
      : { method: 'credit' as const, amount: total, reference: null, cashAccountId: null },
  ];
  const bad = checkPays(refund, total);
  if (bad) return bad;
  const { payments, ledger, cash } = paymentRows(
    ctx,
    'purchase_return',
    returnId,
    supplier.id,
    refund,
    1,
    at,
  );

  return db.transaction(
    'rw',
    [
      db.purchaseReturns,
      db.purchaseReturnLines,
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
    async (): Promise<PostedPurchaseDoc> => {
      const number = await nextNumber(db, ctx.devicePrefix, 'PRT');
      const doc = {
        ...newCommon(ctx),
        id: returnId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        originalInvoiceId: input.originalInvoiceId,
        supplierId: supplier.id,
        warehouseId: input.warehouseId,
        subtotal: total,
        discount: 0,
        total,
      };
      const audit = auditRow(
        ctx,
        'purchase_return_posted',
        'purchase_returns',
        returnId,
        { number, total },
        at,
      );
      await db.purchaseReturns.add(doc);
      await db.purchaseReturnLines.bulkAdd(lines);
      await db.payments.bulkAdd(payments);
      await db.stockMovements.bulkAdd(stock);
      await db.partyLedger.bulkAdd(ledger);
      await db.cashMovements.bulkAdd(cash);
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stock.map((m) => [m.productId, m.warehouseId]),
      );
      if (ledger.length) await rebuildPartyBalances(db, [['supplier', supplier.id]]);
      await enqueue(
        db,
        'purchaseReturns',
        { ...doc, lines, payments, stockMovements: stock, partyLedger: ledger, cashMovements: cash },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, id: returnId, number, total };
    },
  );
}

const supplierPaymentInput = z.object({
  supplierId: id,
  amount: z.number().int().positive(),
  method: z.enum(['cash', 'card', 'instapay', 'wallet', 'other', 'owner']),
  reference: z.string().max(60).nullable().default(null),
  cashAccountId: id.nullable().default(null),
  allocations: z.array(z.object({ invoice_id: id, amount: z.number().int().positive() })).default([]),
});

/** We pay a supplier (manager only): what we owe goes down; cash leaves the chosen account. */
export async function postSupplierPayment(
  ctx: DeviceContext,
  raw: z.input<typeof supplierPaymentInput>,
): Promise<{ ok: true; id: string; number: string; balanceAfter: number } | Err> {
  const parsed = supplierPaymentInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات السداد غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'supplierPayment') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.method === 'cash' && !input.cashAccountId) return err('E_VALIDATION', 'اختار الخزنة');
  if (input.method !== 'cash' && input.method !== 'owner' && !input.reference)
    return err('E_VALIDATION', 'المرجع مطلوب');
  if (input.method === 'owner' && canCtx(ctx, 'payFromOwner') !== 'yes')
    return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const supplier = await db.suppliers.get(input.supplierId);
  if (!supplier || supplier.deletedAt) return err('NOT_FOUND', 'مورد غير موجود');
  if (!(await validateAllocations(db, 'supplier', supplier.id, input.amount, input.allocations)))
    return err('E_VALIDATION', 'تخصيص غير صحيح');
  const paymentId = uuidv7();
  const at = nowIso();
  const ledger: PartyLedgerRow = {
    ...newCommon(ctx),
    partyType: 'supplier',
    partyId: supplier.id,
    amount: input.amount,
    docType: 'supplier_payment',
    docId: paymentId,
    occurredAt: at,
  };
  const cash: CashMovement[] =
    input.method === 'cash'
      ? [
          {
            ...newCommon(ctx),
            cashAccountId: input.cashAccountId!,
            shiftId: null,
            amount: -input.amount,
            method: 'cash',
            docType: 'supplier_payment',
            docId: paymentId,
            occurredAt: at,
          },
        ]
      : [];
  return db.transaction(
    'rw',
    [
      db.supplierPayments,
      db.partyLedger,
      db.cashMovements,
      db.auditLog,
      db.partyBalances,
      db.numberSequences,
      db.outbox,
      db.syncState,
    ],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'PAY');
      const doc = {
        ...newCommon(ctx),
        id: paymentId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        supplierId: supplier.id,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        allocations: input.allocations.length ? input.allocations : null,
      };
      const audit = auditRow(
        ctx,
        'supplier_payment_posted',
        'supplier_payments',
        paymentId,
        { number, amount: input.amount },
        at,
      );
      await db.supplierPayments.add(doc);
      await db.partyLedger.add(ledger);
      await db.cashMovements.bulkAdd(cash);
      await db.auditLog.add(audit);
      await rebuildPartyBalances(db, [['supplier', supplier.id]]);
      await enqueue(
        db,
        'supplierPayments',
        { ...doc, partyLedger: [ledger], cashMovements: cash },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      const balanceAfter = (await db.partyBalances.get(['supplier', supplier.id]))?.amount ?? 0;
      return { ok: true as const, id: paymentId, number, balanceAfter };
    },
  );
}

const adjustmentInput = z.object({
  warehouseId: id,
  reason: z.enum(ADJUSTMENT_REASONS),
  lines: z
    .array(
      z.object({
        productId: id,
        qtyDeltaMilli: z
          .number()
          .int()
          .refine((n) => n !== 0),
      }),
    )
    .min(1),
  approvalTokens: z.array(z.string()).default([]),
});

/** INV-06 / INV-10: correct stock with a reason; above the manager's value limit a manager's PIN is needed. */
export async function postStockAdjustment(
  ctx: DeviceContext,
  raw: z.input<typeof adjustmentInput>,
): Promise<PostedPurchaseDoc | Err> {
  const parsed = adjustmentInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات التسوية غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'stockAdjustment') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.lines.some((l) => !reasonFitsDelta(input.reason, l.qtyDeltaMilli)))
    return err('E_VALIDATION', 'الكمية لا تناسب السبب');
  const { db } = ctx;
  const products = await db.products.bulkGet(input.lines.map((l) => l.productId));
  if (products.some((p) => !p || p.deletedAt || p.type !== 'stock'))
    return err('PRODUCT_NOT_FOUND', 'صنف غير موجود');
  const settings = await loadSettings(db);
  const value = adjustmentValue(
    input.lines.map((l, i) => ({ qtyDelta: l.qtyDeltaMilli, unitCost: products[i]!.unitCost })),
  );
  let approver: string | null = null;
  let token: string | null = null;
  // a device below manager level has no costs, so its value reads 0: the server decides there with the real cost and refuses
  if (
    adjustmentNeedsApproval(settings.stockApprovalAbove, approvalRole(ctx, 'stockAdjustmentOverLimit'), value)
  ) {
    token = input.approvalTokens.find((t) => peekApproval(t, 'stockAdjustmentOverLimit')) ?? null;
    const approval = token ? peekApproval(token, 'stockAdjustmentOverLimit') : null;
    if (!token || !approval) return err('APPROVAL_REQUIRED', 'stockAdjustmentOverLimit');
    approver = approval.approvedBy;
  }
  const adjId = uuidv7();
  const at = nowIso();
  const lines: LooseRow[] = input.lines.map((l, i) => ({
    ...newCommon(ctx),
    adjustmentId: adjId,
    productId: l.productId,
    qtyDelta: l.qtyDeltaMilli,
    unitCost: products[i]!.unitCost,
  }));
  const stock: StockMovement[] = input.lines.map((l, i) => ({
    ...newCommon(ctx),
    productId: l.productId,
    warehouseId: input.warehouseId,
    qty: l.qtyDeltaMilli,
    unitCost: products[i]!.unitCost,
    docType: 'stock_adjustment',
    docId: adjId,
    lineId: null,
    occurredAt: at,
  }));
  if (token) spendApproval(token);
  return db.transaction(
    'rw',
    [
      db.stockAdjustments,
      db.stockAdjustmentLines,
      db.stockMovements,
      db.auditLog,
      db.stockBalances,
      db.numberSequences,
      db.outbox,
      db.syncState,
    ],
    async (): Promise<PostedPurchaseDoc> => {
      const number = await nextNumber(db, ctx.devicePrefix, 'ADJ');
      const doc = {
        ...newCommon(ctx),
        id: adjId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        warehouseId: input.warehouseId,
        reasonCode: input.reason,
        approvedBy: approver,
      };
      const audit = auditRow(
        ctx,
        'stock_adjusted',
        'stock_adjustments',
        adjId,
        { number, reason: input.reason, value },
        at,
        approver,
      );
      await db.stockAdjustments.add(doc);
      await db.stockAdjustmentLines.bulkAdd(lines);
      await db.stockMovements.bulkAdd(stock);
      await db.auditLog.add(audit);
      await rebuildStockBalances(
        db,
        stock.map((m) => [m.productId, m.warehouseId]),
      );
      await enqueue(db, 'stockAdjustments', { ...doc, lines, stockMovements: stock }, ctx.workerId);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true, id: adjId, number, total: value };
    },
  );
}
