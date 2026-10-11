import { Download, Printer } from 'lucide-react';

import { useServices, useSession } from '@/app/session';
import { toCsv } from '@/domain/csv';
import type { ReportTable } from '@/domain/reports';

import { ActionButton } from '../components/ActionButton';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

/** The tables of a report: header row, rows, an optional totals row and a note, in the report-table look. */
export function ReportTableView({ tables }: { tables: ReportTable[] }) {
  return (
    <>
      {tables.map((t, i) => (
        <div key={i} className={styles.section} data-testid={`report-table-${i}`}>
          {i > 0 && <h2>{t.title}</h2>}
          {t.rows.length === 0 && !t.totals ? (
            <p>{strings.reports.none}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.reportTable}>
                <thead>
                  <tr>
                    {t.headers.map((h, hi) => (
                      <th key={h} className={hi > 0 ? styles.num : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td
                          key={ci}
                          dir={ci > 0 ? 'ltr' : undefined}
                          className={ci > 0 ? styles.num : undefined}
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {t.totals && (
                    <tr data-testid={`report-totals-${i}`} className={styles.totalRow}>
                      {t.totals.map((c, ci) => (
                        <td
                          key={ci}
                          dir={ci > 0 ? 'ltr' : undefined}
                          className={ci > 0 ? styles.num : undefined}
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {t.note && <p>{t.note}</p>}
        </div>
      ))}
    </>
  );
}

/** A4 print and CSV download of a report, each shown only to a worker who has that permission. */
export function ReportActions({
  tables,
  title,
  subtitle,
  upTo,
  filename,
}: {
  tables: ReportTable[];
  title: string;
  subtitle: string;
  upTo: string;
  filename: string;
}) {
  const { db } = useServices();
  const { can } = useSession();
  const exportCsv = (): void => {
    const rows: (string | number)[][] = [];
    for (const t of tables) {
      rows.push([t.title], t.headers, ...t.rows);
      if (t.totals) rows.push(t.totals);
      rows.push([]);
    }
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const print = async (): Promise<void> => {
    const [render, { printHtml, cairoFontFaces }, company] = await Promise.all([
      import('../print/render'),
      import('../print/printHtml'),
      db.companies.toCollection().first(),
    ]);
    await printHtml(
      render.renderReportHtml(
        { shopName: company?.name ?? '', title, subtitle, upTo, tables },
        cairoFontFaces(),
      ),
    );
  };
  return (
    <div className={styles.actions}>
      {can('printReports') !== 'no' && (
        <ActionButton
          label={strings.reports.print}
          icon={Printer}
          variant="ghost"
          onClick={() => void print()}
          testId="report-print"
        />
      )}
      {can('exportCsv') !== 'no' && (
        <ActionButton
          label={strings.reports.csv}
          icon={Download}
          variant="ghost"
          onClick={exportCsv}
          testId="report-csv"
        />
      )}
    </div>
  );
}
