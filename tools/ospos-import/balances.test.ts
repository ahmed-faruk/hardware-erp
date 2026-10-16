import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { openingRows, readSheet, suggest, writeSheet } from './balances.ts';
import { legacyId } from './parse.ts';
import { transform } from './transform.ts';
import type { OsposExport } from './types.ts';

const data = JSON.parse(readFileSync('tests/fixtures/ospos-sample-export.json', 'utf8')) as OsposExport;
const result = transform(data);

describe('suggested balances', () => {
  it('credit sales add, credit returns subtract, everything else is zero', () => {
    const { customers, suppliers } = suggest(result);
    expect(customers.find((c) => c.id === legacyId('customer', 20))?.suggested).toBe(6000); // 60.00 on credit in sale 2
    expect(customers.find((c) => c.id === legacyId('customer', 21))?.suggested).toBe(0);
    expect(suppliers.every((s) => s.suggested === 0)).toBe(true);
    expect(suppliers.some((s) => s.name.includes('أرشيف'))).toBe(false); // the placeholder supplier is not listed
  });
});

describe('opening balances sheet', () => {
  const known = {
    customers: new Set(result.tables.customers.map((r) => String(r.id))),
    suppliers: new Set(result.tables.suppliers.filter((r) => r.active).map((r) => String(r.id))),
  };
  const file = join(mkdtempSync(join(tmpdir(), 'ospos-')), 'balances.xlsx');

  async function edit(change: (customers: ExcelJS.Worksheet) => void): Promise<string> {
    await writeSheet(file, suggest(result));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    change(wb.getWorksheet('العملاء')!);
    await wb.xlsx.writeFile(file);
    return file;
  }

  it('round-trips the suggestions', async () => {
    await writeSheet(file, suggest(result));
    const { approved, problems } = await readSheet(file, known);
    expect(problems).toEqual([]);
    expect(approved.customers.get(legacyId('customer', 20))).toBe(6000);
  });
  it('takes the owner edits in pounds with two decimals', async () => {
    await edit((ws) => (ws.getCell('E2').value = 1234.5));
    const { approved, problems } = await readSheet(file, known);
    expect(problems).toEqual([]);
    expect(approved.customers.get(legacyId('customer', 20))).toBe(123450);
  });
  it('reports a non-number, three decimals and a changed id instead of guessing', async () => {
    await edit((ws) => {
      ws.getCell('E2').value = 'abc';
      ws.getCell('E3').value = 10.123;
      ws.getCell('A3').value = 'not-an-id';
    });
    const { problems } = await readSheet(file, known);
    expect(problems.join('\n')).toMatch(/صف 2: الرصيد المعتمد مش رقم/);
    expect(problems.join('\n')).toMatch(/صف 3: معرّف غير معروف/);
    expect(problems.join('\n')).toMatch(/ناقص صف للمعرّف/);
  });
  it('builds one opening document per ledger: customers owe us (+), we owe suppliers (-), zero rows are skipped', () => {
    const approved = {
      customers: new Map([
        [legacyId('customer', 20), 5000],
        [legacyId('customer', 21), 0],
      ]),
      suppliers: new Map([[legacyId('supplier', 30), 7000]]),
    };
    const rows = openingRows(result.stats.companyId, data.meta.exportedAt, approved);
    expect(rows.openings.map((o) => o.kind)).toEqual(['customers', 'suppliers']);
    expect(rows.party_ledger.map((l) => [l.party_type, l.amount])).toEqual([
      ['customer', 5000],
      ['supplier', -7000],
    ]);
    expect(rows.party_ledger.every((l) => l.doc_type === 'opening')).toBe(true);
  });
});

describe('opening cash', () => {
  const none = { customers: new Map<string, number>(), suppliers: new Map<string, number>() };
  it('one cash opening of 1,234.50 goes into the safe as money in', () => {
    const rows = openingRows(
      result.stats.companyId,
      data.meta.exportedAt,
      { ...none, cash: 123450 },
      'safe-1',
    );
    expect(rows.openings.map((o) => o.kind)).toEqual(['customers', 'suppliers', 'cash']);
    expect(rows.cash_movements).toHaveLength(1);
    expect(rows.cash_movements[0]).toMatchObject({
      cash_account_id: 'safe-1',
      amount: 123450,
      doc_type: 'opening',
      method: 'cash',
    });
  });
  it('zero or no cash gives no cash opening', () => {
    for (const cash of [0, undefined]) {
      const rows = openingRows(result.stats.companyId, data.meta.exportedAt, { ...none, cash }, 'safe-1');
      expect(rows.openings.map((o) => o.kind)).toEqual(['customers', 'suppliers']);
      expect(rows.cash_movements).toEqual([]);
    }
  });
  it('the sheet carries the cash: written as 0, read back in piasters, a bad value is reported', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ospos-')), 'cash.xlsx');
    const known = {
      customers: new Set(result.tables.customers.map((r) => String(r.id))),
      suppliers: new Set(result.tables.suppliers.filter((r) => r.active).map((r) => String(r.id))),
    };
    await writeSheet(file, suggest(result));
    expect((await readSheet(file, known)).approved.cash).toBe(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    wb.getWorksheet('النقدية')!.getCell('B1').value = 1234.5;
    await wb.xlsx.writeFile(file);
    expect((await readSheet(file, known)).approved.cash).toBe(123450);
    wb.getWorksheet('النقدية')!.getCell('B1').value = 'abc';
    await wb.xlsx.writeFile(file);
    expect((await readSheet(file, known)).problems.join('\n')).toMatch(/النقدية/);
  });
});
