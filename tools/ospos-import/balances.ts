// Opening balances: the owner approves them in an xlsx, then they become ONE opening document per ledger.
import { readFileSync } from 'node:fs';

import ExcelJS from 'exceljs';

import { legacyId } from './parse.ts';
import type { Row, TransformResult } from './types.ts';

export interface PartyLine {
  id: string;
  name: string;
  phone: string;
  suggested: number;
}

const CUSTOMER_SHEET = 'العملاء';
const SUPPLIER_SHEET = 'الموردين';
const GUIDE_SHEET = 'تعليمات';
const CASH_SHEET = 'النقدية';

/** Suggested balance = credit amounts on history, returns subtracted. OSPOS has no receipts, so the owner corrects every row. */
export function suggest(result: TransformResult): { customers: PartyLine[]; suppliers: PartyLine[] } {
  const owed = (docs: Row[], partyKey: string, types: [string, string]): Map<string, number> => {
    const partyOfDoc = new Map(docs.map((d) => [String(d.id), String(d[partyKey] ?? '')]));
    const out = new Map<string, number>();
    for (const p of result.tables.payments) {
      if (p.method !== 'credit') continue;
      const party = partyOfDoc.get(String(p.document_id));
      if (!party) continue;
      const sign = p.document_type === types[0] ? 1 : p.document_type === types[1] ? -1 : 0;
      out.set(party, (out.get(party) ?? 0) + sign * Number(p.amount));
    }
    return out;
  };
  const cust = owed([...result.tables.sales_invoices, ...result.tables.sales_returns], 'customer_id', [
    'sales_invoice',
    'sales_return',
  ]);
  const sup = owed([...result.tables.purchase_invoices, ...result.tables.purchase_returns], 'supplier_id', [
    'purchase_invoice',
    'purchase_return',
  ]);
  const line = (r: Row, map: Map<string, number>): PartyLine => ({
    id: String(r.id),
    name: String(r.name),
    phone: String(r.phone ?? ''),
    suggested: map.get(String(r.id)) ?? 0,
  });
  return {
    customers: result.tables.customers.map((r) => line(r, cust)),
    suppliers: result.tables.suppliers.filter((r) => r.active).map((r) => line(r, sup)),
  };
}

const toPounds = (piasters: number): number => piasters / 100;

export async function writeSheet(
  file: string,
  lines: { customers: PartyLine[]; suppliers: PartyLine[] },
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const guide = wb.addWorksheet(GUIDE_SHEET, { views: [{ rightToLeft: true }] });
  [
    'الأرصدة الافتتاحية',
    'اكتب في عمود "الرصيد المعتمد (جنيه)" الرصيد الفعلي لكل عميل ومورد وقت بدء التشغيل.',
    'العملاء: الرقم الموجب = العميل عليه فلوس لينا. الموردين: الرقم الموجب = إحنا عليه فلوس للمورد.',
    'عمود "المقترح" محسوب من النظام القديم، وهو دايمًا صفر تقريبًا لأن النظام القديم ماكانش بيسجل التحصيل.',
    'لا تغيّر عمود "المعرّف" ولا تحذف صفوف. القيمة بالجنيه، وحد أقصى رقمين بعد العلامة العشرية.',
    'ورقة "النقدية": اكتب الفلوس اللي معاك فعلاً في الخزنة يوم بدء التشغيل (جنيه). صفر أو فاضي = مفيش رصيد افتتاحي للنقدية.',
  ].forEach((t, i) => (guide.getCell(`A${i + 1}`).value = t));
  guide.getColumn(1).width = 110;
  guide.getCell('A1').font = { bold: true, size: 14 };
  for (const [name, rows] of [
    [CUSTOMER_SHEET, lines.customers],
    [SUPPLIER_SHEET, lines.suppliers],
  ] as const) {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'المعرّف', key: 'id', width: 40 },
      { header: 'الاسم', key: 'name', width: 32 },
      { header: 'الموبايل', key: 'phone', width: 16 },
      { header: 'المقترح (جنيه)', key: 'suggested', width: 16 },
      { header: 'الرصيد المعتمد (جنيه)', key: 'approved', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows)
      ws.addRow({
        id: r.id,
        name: r.name,
        phone: r.phone,
        suggested: toPounds(r.suggested),
        approved: toPounds(r.suggested),
      });
    ws.getColumn('phone').numFmt = '@';
    ws.getColumn('suggested').numFmt = '#,##0.00';
    ws.getColumn('approved').numFmt = '#,##0.00';
  }
  const cash = wb.addWorksheet(CASH_SHEET, { views: [{ rightToLeft: true }] });
  cash.getCell('A1').value = 'الفلوس اللي في الخزنة يوم بدء التشغيل (جنيه)';
  cash.getCell('B1').value = 0;
  cash.getCell('B1').numFmt = '#,##0.00';
  cash.getColumn(1).width = 50;
  cash.getColumn(2).width = 18;
  await wb.xlsx.writeFile(file);
}

export interface Approved {
  customers: Map<string, number>;
  suppliers: Map<string, number>;
  /** the cash counted in the shop on the cutover day, piasters (0 or missing = no cash opening) */
  cash?: number;
}

/** Reads the owner's sheet. Every problem is reported; nothing is guessed. */
export async function readSheet(
  file: string,
  known: { customers: Set<string>; suppliers: Set<string> },
): Promise<{ approved: Approved; problems: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(file) as unknown as ArrayBuffer);
  const problems: string[] = [];
  const read = (sheet: string, ids: Set<string>): Map<string, number> => {
    const out = new Map<string, number>();
    const ws = wb.getWorksheet(sheet);
    if (!ws) {
      problems.push(`الورقة "${sheet}" مش موجودة`);
      return out;
    }
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const id = String(row.getCell(1).value ?? '').trim();
      const raw = row.getCell(5).value;
      const value =
        typeof raw === 'object' && raw !== null && 'result' in raw ? Number(raw.result) : Number(raw);
      if (!ids.has(id)) return void problems.push(`${sheet} صف ${n}: معرّف غير معروف`);
      if (raw === null || raw === '' || !Number.isFinite(value))
        return void problems.push(`${sheet} صف ${n}: الرصيد المعتمد مش رقم`);
      if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)
        return void problems.push(`${sheet} صف ${n}: أكتر من رقمين عشريين`);
      if (out.has(id)) return void problems.push(`${sheet} صف ${n}: المعرّف مكرر`);
      out.set(id, Math.round(value * 100));
    });
    for (const id of ids) if (!out.has(id)) problems.push(`${sheet}: ناقص صف للمعرّف ${id}`);
    return out;
  };
  const customers = read(CUSTOMER_SHEET, known.customers);
  const suppliers = read(SUPPLIER_SHEET, known.suppliers);
  let cash = 0;
  const cashSheet = wb.getWorksheet(CASH_SHEET);
  const rawCash = cashSheet?.getCell('B1').value;
  if (rawCash !== null && rawCash !== undefined && rawCash !== '') {
    const v = typeof rawCash === 'object' && 'result' in rawCash ? Number(rawCash.result) : Number(rawCash);
    if (!Number.isFinite(v) || v < 0) problems.push(`${CASH_SHEET}: القيمة مش رقم صحيح`);
    else if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6)
      problems.push(`${CASH_SHEET}: أكتر من رقمين عشريين`);
    else cash = Math.round(v * 100);
  }
  return { approved: { customers, suppliers, cash }, problems };
}

/** Opening documents + ledger rows. Customers: + = owes us. Suppliers: ledger is negative when we owe them. */
export function openingRows(
  companyId: string,
  exportedAt: string,
  approved: Approved,
  safeAccountId: string | null = null,
): { openings: Row[]; party_ledger: Row[]; cash_movements: Row[] } {
  const common = (id: string) => ({
    id,
    company_id: companyId,
    device_id: null,
    created_by: null,
    created_at: exportedAt,
    updated_at: exportedAt,
    version: 1,
    deleted_at: null,
  });
  const openings: Row[] = [];
  const party_ledger: Row[] = [];
  let n = 2;
  for (const [kind, partyType, map, sign] of [
    ['customers', 'customer', approved.customers, 1],
    ['suppliers', 'supplier', approved.suppliers, -1],
  ] as const) {
    const id = legacyId('opening', kind);
    openings.push({
      ...common(id),
      number: `LG-OPN-${String(n++).padStart(6, '0')}`,
      issued_at: exportedAt,
      worker_id: null,
      shift_id: null,
      status: 'posted',
      voided_by: null,
      notes: 'رصيد افتتاحي معتمد من المالك',
      is_legacy: false,
      legacy: null,
      kind,
      approved_by: null,
    });
    for (const [partyId, amount] of map) {
      if (amount === 0) continue;
      party_ledger.push({
        ...common(legacyId('opening-balance', `${kind}:${partyId}`)),
        party_type: partyType,
        party_id: partyId,
        amount: sign * amount,
        doc_type: 'opening',
        doc_id: id,
        occurred_at: exportedAt,
      });
    }
  }
  // the cash counted on the cutover day goes into the main safe as one opening movement (money in)
  const cash_movements: Row[] = [];
  if ((approved.cash ?? 0) > 0 && safeAccountId) {
    const id = legacyId('opening', 'cash');
    openings.push({
      ...common(id),
      number: `LG-OPN-${String(n++).padStart(6, '0')}`,
      issued_at: exportedAt,
      worker_id: null,
      shift_id: null,
      status: 'posted',
      voided_by: null,
      notes: 'رصيد افتتاحي للنقدية معتمد من المالك',
      is_legacy: false,
      legacy: null,
      kind: 'cash',
      approved_by: null,
    });
    cash_movements.push({
      ...common(legacyId('opening-balance', 'cash')),
      cash_account_id: safeAccountId,
      shift_id: null,
      amount: approved.cash!,
      method: 'cash',
      doc_type: 'opening',
      doc_id: id,
      occurred_at: exportedAt,
    });
  }
  return { openings, party_ledger, cash_movements };
}
