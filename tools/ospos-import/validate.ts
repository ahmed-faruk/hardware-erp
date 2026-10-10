// Validation report (skill ospos-migration §5). Blocking checks decide the exit code; the report holds counts only, no customer data.
import { client } from './load.ts';
import { parseMoney } from './parse.ts';
import type { OsposExport, Row, TableName, TransformResult } from './types.ts';

type Db = ReturnType<typeof client>;
type Status = 'pass' | 'fail' | 'pending';
interface Check {
  name: string;
  status: Status;
  blocking: boolean;
  detail: string;
}

const egp = (piasters: number): string =>
  (piasters / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function count(db: Db, table: string, companyId: string, legacy?: boolean): Promise<number> {
  let q = db.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if (legacy !== undefined) q = q.eq('is_legacy', legacy);
  const { count: n, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return n ?? 0;
}

async function fetchAll(
  db: Db,
  table: string,
  columns: string,
  companyId: string,
  match: Record<string, string | boolean> = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq('company_id', companyId)
      .match(match)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ValidateInput {
  data: OsposExport;
  result: TransformResult;
  db: Db;
  host: string;
  /** approved opening balances that were applied (piasters), if any */
  applied: { customers: Record<string, number>; suppliers: Record<string, number> } | null;
}

export async function validate(input: ValidateInput): Promise<{ markdown: string; blockingFailed: boolean }> {
  const { data, result, db, host, applied } = input;
  const cid = result.stats.companyId;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, blocking: boolean, detail: string): void =>
    void checks.push({ name, status: ok ? 'pass' : 'fail', blocking, detail });
  const warn = (code: string): number => result.warnings.find((w) => w.code === code)?.count ?? 0;
  const counts = data.meta.counts;

  // 1. counts: export -> transformed rows -> database
  const t = result.tables;
  const expected: [string, TableName[], number, number][] = [
    ['products', ['products'], Number(counts.items), 0],
    ['customers', ['customers'], Number(counts.customers), 0],
    ['suppliers', ['suppliers'], Number(counts.suppliers) + 1, 0], // + the archive placeholder
    ['workers', ['workers'], Number(counts.employees), 0],
    [
      'sales + returns',
      ['sales_invoices', 'sales_returns'],
      Number(counts.sales) - warn('UNKNOWN_SALE_TYPE') - warn('BAD_SALE_ROW'),
      0,
    ],
    [
      'purchases + returns',
      ['purchase_invoices', 'purchase_returns'],
      Number(counts.receivings) - result.stats.requisitions.length - warn('BAD_RECEIVING_ROW'),
      0,
    ],
    ['expenses', ['expenses'], Number(counts.expenses) - warn('EXPENSE_SKIPPED'), 0],
  ];
  for (const [label, tables, want] of expected) {
    const transformed = tables.reduce((a, name) => a + t[name].length, 0);
    let inDb = 0;
    for (const name of tables) inDb += await count(db, name, cid);
    add(
      `Count: ${label}`,
      transformed === want && inDb === want,
      true,
      `export ${want} · transformed ${transformed} · database ${inDb}`,
    );
  }
  for (const name of [
    'sales_invoice_lines',
    'sales_return_lines',
    'purchase_invoice_lines',
    'purchase_return_lines',
    'payments',
    'barcodes',
    'categories',
    'expense_categories',
    'stock_movements',
  ] as TableName[]) {
    const inDb = await count(db, name, cid);
    add(`Count: ${name}`, inDb === t[name].length, true, `transformed ${t[name].length} · database ${inDb}`);
  }

  // 2. sales coverage
  const months = Object.keys(result.stats.salesTotalByMonth).sort();
  const gaps: string[] = [];
  if (months.length) {
    let [y, m] = (months[0] as string).split('-').map(Number) as [number, number];
    const [ly, lm] = (months.at(-1) as string).split('-').map(Number) as [number, number];
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!(key in result.stats.salesTotalByMonth)) gaps.push(key);
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }
  const diff = Number(counts.sales) - data.meta.salesSearchTotal;
  add(
    'Sales coverage',
    gaps.length === 0 && Math.abs(diff) <= 5,
    true,
    `exported ${counts.sales} vs OSPOS search total ${data.meta.salesSearchTotal} (difference ${diff}; canceled/suspended sales are not exported) · months without sales: ${gaps.length ? gaps.join(', ') : 'none'}`,
  );

  // 3. monthly totals: database vs export
  const dbMonthly: Record<string, number> = {};
  for (const r of await fetchAll(db, 'sales_invoices', 'issued_at,total', cid, { is_legacy: true })) {
    const k = String(r.issued_at).slice(0, 7);
    dbMonthly[k] = (dbMonthly[k] ?? 0) + Number(r.total);
  }
  for (const r of await fetchAll(db, 'sales_returns', 'issued_at,total', cid, { is_legacy: true })) {
    const k = String(r.issued_at).slice(0, 7);
    dbMonthly[k] = (dbMonthly[k] ?? 0) - Number(r.total);
  }
  const badMonths = months.filter((k) => dbMonthly[k] !== result.stats.salesTotalByMonth[k]);
  add(
    'Monthly sales totals (database = export)',
    badMonths.length === 0,
    true,
    badMonths.length ? `differs in ${badMonths.join(', ')}` : `${months.length} months match`,
  );
  const picks = months.length
    ? ([months[0], months[Math.floor(months.length / 2)], months.at(-1)] as string[])
    : [];
  checks.push({
    name: 'Monthly totals = OSPOS "Summary sales" report (3 months)',
    status: 'pending',
    blocking: true,
    detail:
      picks.map((k) => `${k}: ${egp(dbMonthly[k] ?? 0)} EGP`).join(' · ') +
      ' — the owner compares these with the OSPOS report for the same months',
  });

  // 3b. the manager's server report (report_sales_summary_core, by Cairo day) gives the same month totals as the OSPOS export
  {
    const bad: string[] = [];
    const lines: string[] = [];
    for (const k of picks) {
      const [y, mo] = k.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const { data: rep, error } = await db.rpc('report_sales_summary_core', {
        p_company: cid,
        p_from: `${k}-01`,
        p_to: `${k}-${String(last).padStart(2, '0')}`,
      });
      const net = error ? NaN : Number((rep as { total: { net: number } }).total.net);
      lines.push(`${k}: ${error ? error.message : egp(net)} EGP`);
      if (net !== result.stats.salesTotalByMonth[k]) bad.push(k);
    }
    add(
      'Report totals = export (report_sales_summary_core, 3 months)',
      picks.length > 0 && bad.length === 0,
      true,
      bad.length ? `differs in ${bad.join(', ')} · ${lines.join(' · ')}` : lines.join(' · '),
    );
  }

  // 4. stock
  const opening = await fetchAll(db, 'stock_movements', 'product_id,qty', cid, { doc_type: 'opening' });
  const dbStock = new Map(opening.map((r) => [String(r.product_id), Number(r.qty)]));
  const stockBad = Object.entries(result.stats.stockByProduct).filter(
    ([id, qty]) => (dbStock.get(id) ?? 0) !== qty,
  ).length;
  add(
    'Stock opening = inventory summary',
    stockBad === 0,
    true,
    `${Object.keys(result.stats.stockByProduct).length} products, ${stockBad} differ`,
  );

  // 5. opening balances
  if (!applied) {
    checks.push({
      name: 'Opening balances = approved xlsx',
      status: 'pending',
      blocking: true,
      detail: 'not applied yet (run: import balances, owner fills the sheet, then apply-balances)',
    });
  } else {
    const ledger = await fetchAll(db, 'party_ledger', 'party_type,party_id,amount', cid, {
      doc_type: 'opening',
    });
    const cust = new Map(
      ledger.filter((r) => r.party_type === 'customer').map((r) => [String(r.party_id), Number(r.amount)]),
    );
    const sup = new Map(
      ledger.filter((r) => r.party_type === 'supplier').map((r) => [String(r.party_id), Number(r.amount)]),
    );
    const bad = [
      ...Object.entries(applied.customers).filter(([id, v]) => (cust.get(id) ?? 0) !== v),
      ...Object.entries(applied.suppliers).filter(([id, v]) => (sup.get(id) ?? 0) !== -v),
    ].length;
    add(
      'Opening balances = approved xlsx',
      bad === 0,
      true,
      `${Object.keys(applied.customers).length} customers, ${Object.keys(applied.suppliers).length} suppliers, ${bad} differ`,
    );
  }

  // 6. 20 random sales: lines, totals and payments against the export
  const rng = mulberry32(20261009);
  const invoices = t.sales_invoices;
  const sample = Array.from(
    { length: Math.min(20, invoices.length) },
    () => invoices[Math.floor(rng() * invoices.length)] as Row,
  );
  const bySaleId = new Map(data.sales.map((s) => [String(s.id), s]));
  let sampleBad = 0;
  const sampleNotes: string[] = [];
  for (const inv of sample) {
    const sale = bySaleId.get(String((inv.legacy as { ospos_id: number }).ospos_id));
    const { data: row } = await db
      .from('sales_invoices')
      .select('number,total,tax_total,cash_rounding')
      .eq('id', String(inv.id))
      .single();
    const lines = await fetchAll(db, 'sales_invoice_lines', 'net_amount', cid, {
      invoice_id: String(inv.id),
    });
    const pays = await fetchAll(db, 'payments', 'amount', cid, { document_id: String(inv.id) });
    const total = parseMoney(sale?.total ?? '') ?? NaN;
    const tax = Number(row?.tax_total ?? 0);
    const exportLines = data.sale_lines[String(sale?.id)] ?? [];
    const problems: string[] = [];
    if (row?.total !== total) problems.push('total');
    if (lines.length !== exportLines.length) problems.push('line count');
    if (lines.reduce((a, l) => a + Number(l.net_amount), 0) + tax !== total)
      problems.push('lines + tax != total');
    if (pays.reduce((a, p) => a + Number(p.amount), 0) - Number(row?.cash_rounding ?? 0) !== total)
      problems.push('payments');
    if (problems.length) {
      sampleBad += 1;
      sampleNotes.push(`${row?.number ?? inv.number}: ${problems.join(', ')}`);
    }
  }
  add(
    'Sample of 20 sales (lines, totals, payments)',
    sampleBad === 0,
    true,
    `${sample.length} checked, ${sampleBad} differ${sampleNotes.length ? ` (${sampleNotes.join('; ')})` : ''}`,
  );

  const blockingFailed = checks.some((c) => c.blocking && c.status === 'fail');
  const pending = checks.filter((c) => c.status === 'pending');
  const icon = { pass: '✅', fail: '❌', pending: '⏳' } as const;
  const md = [
    '# تقرير مطابقة النقل من OpenSourcePOS',
    '',
    `- الهدف: \`${host}\` · التصدير: ${data.meta.exportedAt} · التاريخ: ${new Date().toISOString()}`,
    `- النتيجة: ${blockingFailed ? '❌ **فيه فحص أساسي فشل — ممنوع التوقيع**' : pending.length ? `⏳ **سليم لحد دلوقتي، ناقص ${pending.length} فحص يدوي/معلق قبل التوقيع**` : '✅ **كل الفحوصات الأساسية سليمة**'}`,
    '',
    '## الفحوصات',
    '| الفحص | النتيجة | أساسي | التفاصيل |',
    '| --- | --- | --- | --- |',
    ...checks.map((c) => `| ${c.name} | ${icon[c.status]} | ${c.blocking ? 'نعم' : 'لا'} | ${c.detail} |`),
    '',
    '## تحذيرات (غير مانعة)',
    '| الكود | العدد | الشرح |',
    '| --- | --- | --- |',
    ...result.warnings.map((w) => `| ${w.code} | ${w.count} | ${w.note} |`),
    `| EXPORT_ERRORS | ${data.meta.errors.length} | أخطاء مسجلة وقت التصدير |`,
    '',
    '## توقيع المالك',
    '- [ ] راجعت الأرقام وأوافق على بدء البيع في النظام الجديد.',
    '',
  ].join('\n');
  return { markdown: md, blockingFailed };
}
