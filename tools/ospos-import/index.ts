// OpenSourcePOS -> Hanafy POS. Usage: npm run import -- <step> [--confirm <host>]
//   read | transform | balances | apply-balances | load | validate | images
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { openingRows, readSheet, suggest, writeSheet } from './balances.ts';
import { exportFile, OUT, ROOT, target } from './env.ts';
import { client, loadAll } from './load.ts';
import { transform } from './transform.ts';
import { TABLE_ORDER, type OsposExport, type Row, type TableName, type TransformResult } from './types.ts';
import { validate } from './validate.ts';

const [step = '', ...rest] = process.argv.slice(2);
const confirm = rest.includes('--confirm') ? rest[rest.indexOf('--confirm') + 1] : undefined;
const ROWS = `${OUT}rows/`;
const SHEET = process.env.OSPOS_BALANCES_FILE ?? `${ROOT}migration-data/opening-balances.xlsx`;
const appliedFile = (host: string): string =>
  `${OUT}opening-applied-${host.replace(/[^a-z0-9.-]/gi, '_')}.json`;

function readExport(): OsposExport {
  const data = JSON.parse(readFileSync(exportFile(), 'utf8')) as OsposExport;
  if (data.meta.format !== 'ospos-browser-export/1')
    throw new Error(`Unexpected export format: ${data.meta.format}`);
  if (data.meta.saleLineColumns.length !== 11 || data.meta.receivingLineColumns.length !== 6)
    throw new Error('Line column layout changed: parsing would be wrong');
  return data;
}

function saveRows(tables: Record<TableName, Row[]>): void {
  rmSync(ROWS, { recursive: true, force: true });
  mkdirSync(ROWS, { recursive: true });
  for (const name of TABLE_ORDER) {
    const file = `${ROWS}${name}.jsonl`;
    writeFileSync(file, '');
    const rows = tables[name];
    for (let i = 0; i < rows.length; i += 20000)
      appendFileSync(
        file,
        rows
          .slice(i, i + 20000)
          .map((r) => JSON.stringify(r))
          .join('\n') + '\n',
      );
  }
}

function loadRows(): Record<TableName, Row[]> {
  return Object.fromEntries(
    TABLE_ORDER.map((name) => {
      const file = `${ROWS}${name}.jsonl`;
      if (!existsSync(file)) throw new Error(`Missing ${file}: run the transform step first`);
      return [
        name,
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Row),
      ];
    }),
  ) as Record<TableName, Row[]>;
}

function runTransform(): { data: OsposExport; result: TransformResult } {
  const data = readExport();
  return { data, result: transform(data) };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  switch (step) {
    case 'read': {
      const data = readExport();
      console.log(`file: ${exportFile()}\nformat ${data.meta.format}, exported ${data.meta.exportedAt}`);
      console.log('counts:', JSON.stringify(data.meta.counts));
      console.log(`export errors: ${data.meta.errors.length}`);
      break;
    }
    case 'transform': {
      const { result } = runTransform();
      saveRows(result.tables);
      writeFileSync(
        `${OUT}transform-report.json`,
        JSON.stringify(
          { warnings: result.warnings, stats: { ...result.stats, stockByProduct: undefined } },
          null,
          1,
        ),
      );
      for (const name of TABLE_ORDER) console.log(`${name.padEnd(24)} ${result.tables[name].length}`);
      console.log('\nwarnings:');
      for (const w of result.warnings)
        console.log(`  ${w.code.padEnd(30)} ${String(w.count).padStart(7)}  ${w.note}`);
      console.log(
        `\nrequisitions skipped: ${result.stats.requisitions.length}; rows written to tools/ospos-import/out/rows/`,
      );
      break;
    }
    case 'balances': {
      const { result } = runTransform();
      const lines = suggest(result);
      await writeSheet(SHEET, lines);
      const nonZero = [...lines.customers, ...lines.suppliers].filter((l) => l.suggested !== 0).length;
      console.log(
        `${SHEET}\n${lines.customers.length} customers, ${lines.suppliers.length} suppliers (${nonZero} with a non-zero suggestion)`,
      );
      break;
    }
    case 'apply-balances': {
      const { data, result } = runTransform();
      const known = {
        customers: new Set(result.tables.customers.map((r) => String(r.id))),
        suppliers: new Set(result.tables.suppliers.filter((r) => r.active).map((r) => String(r.id))),
      };
      const { approved, problems } = await readSheet(SHEET, known);
      if (problems.length) {
        console.error(`The sheet has ${problems.length} problem(s); nothing was imported:`);
        problems.slice(0, 20).forEach((p) => console.error(`  - ${p}`));
        process.exitCode = 1;
        return;
      }
      const t = target(confirm);
      const db = client(t);
      const { count } = await db
        .from('openings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', result.stats.companyId)
        .in('kind', ['customers', 'suppliers']);
      if (count) {
        console.error(
          'Opening balances were already applied here. Re-applying would be ignored silently; post corrections as documents instead.',
        );
        process.exitCode = 1;
        return;
      }
      let safeId: string | null = null;
      if ((approved.cash ?? 0) > 0) {
        const { data: safe } = await db
          .from('cash_accounts')
          .select('id')
          .eq('company_id', result.stats.companyId)
          .eq('kind', 'safe')
          .is('deleted_at', null)
          .limit(1);
        safeId = (safe?.[0]?.id as string | undefined) ?? null;
        if (!safeId) {
          console.error(
            'There is no main safe yet: run "npm run device:add" for the first device, then apply the balances.',
          );
          process.exitCode = 1;
          return;
        }
      }
      const rows = openingRows(result.stats.companyId, data.meta.exportedAt, approved, safeId);
      await loadAll(
        db,
        { openings: rows.openings, cash_movements: rows.cash_movements, party_ledger: rows.party_ledger },
        console.log,
      );
      writeFileSync(
        appliedFile(t.host),
        JSON.stringify({
          customers: Object.fromEntries(approved.customers),
          suppliers: Object.fromEntries(approved.suppliers),
        }),
      );
      console.log(`applied on ${t.host}`);
      break;
    }
    case 'load': {
      const t = target(confirm);
      console.log(`loading into ${t.host}`);
      const rows = loadRows();
      await loadAll(client(t), rows, console.log);
      console.log('done. Next: npm run import -- validate');
      break;
    }
    case 'validate': {
      const t = target(confirm);
      const { data, result } = runTransform();
      const applied = existsSync(appliedFile(t.host))
        ? (JSON.parse(readFileSync(appliedFile(t.host), 'utf8')) as {
            customers: Record<string, number>;
            suppliers: Record<string, number>;
          })
        : null;
      const { markdown, blockingFailed } = await validate({
        data,
        result,
        db: client(t),
        host: t.host,
        applied,
      });
      writeFileSync(`${OUT}validation-report.md`, markdown);
      console.log(markdown.split('\n').slice(0, 24).join('\n'));
      console.log('\nfull report: tools/ospos-import/out/validation-report.md');
      process.exitCode = blockingFailed ? 1 : 0;
      break;
    }
    case 'images':
      console.log('Skipped: the first export has no product photos (item_pic_url is empty for every item).');
      break;
    default:
      console.error(
        'Usage: npm run import -- <read|transform|balances|apply-balances|load|validate|images> [--confirm <host>]',
      );
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
