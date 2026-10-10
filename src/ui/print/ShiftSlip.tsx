import type { ShiftReportData } from '@/db/shift-report';
import { localizeDigits, type DigitStyle } from '@/domain/digits';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { strings } from '../strings.ar';

/** X (open) or Z (closed) report on the thermal printer. The Z shows what the cashier counted against what was expected. */
export function ShiftSlip({ data, digits }: { data: ShiftReportData; digits: DigitStyle }) {
  const d = (t: string): string => localizeDigits(t, digits);
  const m = (p: number): string => d(formatMoney(p));
  const r = data.report;
  const row = (label: string, value: number, bold = false) => (
    <div className="row" style={bold ? { fontWeight: 700 } : undefined} key={label}>
      <span>{label}</span>
      <span className="num">{m(value)}</span>
    </div>
  );
  return (
    <div dir="rtl">
      <div className="center shop">{data.shopName}</div>
      <div className="banner">{data.closed ? strings.shift.z : strings.shift.x}</div>
      <div className="id">{d(data.number)}</div>
      <div className="row small">
        <span>{`${strings.receipt.cashier}: ${data.workerName}`}</span>
      </div>
      <div className="row small">
        <span className="num">{d(cairoTime(data.openedAt))}</span>
        <span className="num">{data.closedAt ? d(cairoTime(data.closedAt)) : ''}</span>
      </div>
      <hr className="rule" />
      {row(strings.shift.openingFloat, r.openingFloat)}
      <div className="name">{strings.shift.sales}</div>
      {Object.entries(r.salesByMethod).map(([k, v]) =>
        row(strings.receipt.pay[k as keyof typeof strings.receipt.pay] ?? k, v),
      )}
      {row(strings.shift.salesTotal, r.salesTotal, true)}
      {row(`${strings.shift.returns} (${d(String(r.returnsCount))})`, r.returnsTotal)}
      <div className="name">{strings.shift.collections}</div>
      {Object.entries(r.collectionsByMethod).map(([k, v]) =>
        row(strings.receipt.pay[k as keyof typeof strings.receipt.pay] ?? k, v),
      )}
      {row(strings.shift.expenses, r.expenses)}
      {row(strings.shift.transfers, r.transfersOut)}
      <div className="row">
        <span>{strings.shift.noSale}</span>
        <span className="num">{d(String(r.noSaleCount))}</span>
      </div>
      <div className="row">
        <span>{strings.shift.voids}</span>
        <span className="num">{d(String(r.voidsCount))}</span>
      </div>
      <hr className="rule" />
      {row(strings.shift.expected, r.expected, true)}
      {data.closed && r.counted !== null && row(strings.shift.counted, r.counted, true)}
      {data.closed && r.variance !== null && (
        <div className="row total">
          <span>{strings.shift.variance}</span>
          <span className="num">{m(r.variance)}</span>
        </div>
      )}
      {data.note && <div className="small">{data.note}</div>}
    </div>
  );
}

export function MoneySlip({
  shopName,
  title,
  number,
  at,
  lines,
  worker,
  digits,
}: {
  shopName: string;
  title: string;
  number: string;
  at: string;
  lines: { label: string; amount: number }[];
  worker: string;
  digits: DigitStyle;
}) {
  const d = (t: string): string => localizeDigits(t, digits);
  return (
    <div dir="rtl">
      <div className="center shop">{shopName}</div>
      <div className="banner">{title}</div>
      <div className="id">{d(number)}</div>
      <div className="row small">
        <span className="num">{d(cairoTime(at))}</span>
        <span>{`${strings.receipt.cashier}: ${worker}`}</span>
      </div>
      <hr className="rule" />
      {lines.map((l) => (
        <div className="row total" key={l.label}>
          <span>{l.label}</span>
          <span className="num">{d(formatMoney(l.amount))}</span>
        </div>
      ))}
    </div>
  );
}
