import type { ReportTable } from '@/domain/reports';

/** A4 report: every table with its headers, rows and totals. The same tables feed the screen and the CSV. */
export function ReportDocument({
  shopName,
  title,
  subtitle,
  upTo,
  tables,
}: {
  shopName: string;
  title: string;
  subtitle: string;
  upTo: string;
  tables: ReportTable[];
}) {
  return (
    <div dir="rtl">
      <h1>{shopName}</h1>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <p>{upTo}</p>
      {tables.map((t, i) => (
        <section key={i}>
          {i > 0 && <h3>{t.title}</h3>}
          <table>
            <thead>
              <tr>
                {t.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className={ci > 0 ? 'num' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              {t.totals && (
                <tr className="sum">
                  {t.totals.map((c, ci) => (
                    <td key={ci} className={ci > 0 ? 'num' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          {t.note && <p>{t.note}</p>}
        </section>
      ))}
    </div>
  );
}
