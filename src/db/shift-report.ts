import type { HanafyDB } from './schema';
import { buildShiftReport, type ShiftReport } from '@/domain/shiftReport';

export interface ShiftReportData {
  shopName: string;
  number: string;
  workerName: string;
  openedAt: string;
  closedAt: string | null;
  closed: boolean;
  report: ShiftReport;
  note: string | null;
}

/** X while the shift is open, Z once closed: everything is read back from the saved rows of this shift. */
export async function loadShiftReport(db: HanafyDB, shiftId: string): Promise<ShiftReportData | null> {
  const shift = await db.shifts.get(shiftId);
  if (!shift) return null;
  const [invoices, returns, collections, noSales, voids, movements, company, worker] = await Promise.all([
    db.salesInvoices.where('shiftId').equals(shiftId).toArray(),
    db.salesReturns.filter((r) => r.shiftId === shiftId).toArray(),
    db.customerReceipts.filter((r) => r.shiftId === shiftId).toArray(),
    db.auditLog
      .filter(
        (a) =>
          a.action === 'no_sale' &&
          a.occurredAt >= shift.openedAt &&
          (!shift.closedAt || a.occurredAt <= shift.closedAt),
      )
      .toArray(),
    db.voids.filter((v) => v.shiftId === shiftId).toArray(),
    db.cashMovements.where('shiftId').equals(shiftId).toArray(),
    db.companies.toCollection().first(),
    shift.workerId ? db.workers.get(shift.workerId) : Promise.resolve(undefined),
  ]);
  const posted = invoices.filter((i) => i.status === 'posted');
  const payments = (
    await Promise.all(
      posted.map((i) =>
        db.payments.where('[documentType+documentId]').equals(['sales_invoice', i.id]).toArray(),
      ),
    )
  ).flat();
  const report = buildShiftReport({
    openingFloat: shift.openingFloat,
    salesPayments: payments.map((p) => ({ method: p.method, amount: p.amount })),
    cashMovements: movements
      .filter((m) => m.cashAccountId === shift.cashAccountId)
      .map((m) => ({ docType: m.docType, amount: m.amount })),
    returnsTotal: returns.reduce((a, r) => a + (r.total as number), 0),
    returnsCount: returns.length,
    voidsCount: voids.length,
    noSaleCount: noSales.length,
    collections: collections.map((c) => ({ method: c.method as string, amount: c.amount as number })),
    counted: shift.status === 'closed' ? shift.countedTotal : null,
  });
  return {
    shopName: company?.name ?? '',
    number: shift.number,
    workerName: worker?.name ?? '',
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    closed: shift.status === 'closed',
    report,
    note: shift.closeNote,
  };
}
