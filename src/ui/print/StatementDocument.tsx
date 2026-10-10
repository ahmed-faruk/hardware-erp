import { localizeDigits, type DigitStyle } from '@/domain/digits';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';
import type { Statement } from '@/domain/statement';

import { strings } from '../strings.ar';

/** A4 account statement for a customer or supplier: opening balance, every row with a running balance, closing balance, aging. */
export function StatementDocument({
  shopName,
  partyName,
  period,
  statement,
  digits,
}: {
  shopName: string;
  partyName: string;
  period: { from: string; to: string };
  statement: Statement;
  digits: DigitStyle;
}) {
  const d = (t: string): string => localizeDigits(t, digits);
  const m = (p: number): string => d(formatMoney(p));
  const a = statement.aging;
  return (
    <div dir="rtl">
      <h1>{shopName}</h1>
      <h2>{`${strings.receipt.statement}: ${partyName}`}</h2>
      <p>{`${strings.receipt.period}: ${d(period.from)} → ${d(period.to)}`}</p>
      <table>
        <thead>
          <tr>
            <th>{strings.receipt.date}</th>
            <th>{strings.receipt.document}</th>
            <th>{strings.receipt.amount}</th>
            <th>{strings.common.balance}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3}>{strings.receipt.opening}</td>
            <td className="num">{m(statement.opening)}</td>
          </tr>
          {statement.rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{d(cairoTime(r.occurredAt).slice(0, 10))}</td>
              <td className="num">{d(r.docNumber)}</td>
              <td className="num">{m(r.amount)}</td>
              <td className="num">{m(r.balance)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={3}>{strings.receipt.closing}</td>
            <td className="num">{m(statement.closing)}</td>
          </tr>
        </tbody>
      </table>
      <h3>{strings.receipt.aging}</h3>
      <table>
        <tbody>
          <tr>
            <th>{strings.receipt.days0}</th>
            <th>{strings.receipt.days31}</th>
            <th>{strings.receipt.days61}</th>
            <th>{strings.receipt.days90}</th>
          </tr>
          <tr>
            <td className="num">{m(a.d0to30)}</td>
            <td className="num">{m(a.d31to60)}</td>
            <td className="num">{m(a.d61to90)}</td>
            <td className="num">{m(a.d90plus)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export const a4Css = (fontFaces = ''): string => `${fontFaces}
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
body { font-family: Cairo, Tahoma, Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; }
h1 { font-size: 18pt; margin: 0 0 2mm; } h2 { font-size: 14pt; margin: 0 0 2mm; } h3 { font-size: 12pt; margin: 6mm 0 2mm; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.3mm solid #000; padding: 1.5mm 2mm; text-align: start; }
.num { direction: ltr; unicode-bidi: plaintext; white-space: nowrap; text-align: end; font-variant-numeric: tabular-nums; }
.sum td { font-weight: 700; }
tr { break-inside: avoid; }
`;
