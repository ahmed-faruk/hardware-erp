import type { CollectionSlipData } from '@/db/commands/receipts';
import { localizeDigits, type DigitStyle } from '@/domain/digits';
import { formatMoney } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { strings } from '../strings.ar';

import { Barcode } from './Receipt';

/** The customer's proof that he paid on account: amount, method and what he still owes. */
export function CollectionSlip({ slip, digits }: { slip: CollectionSlipData; digits: DigitStyle }) {
  const d = (t: string): string => localizeDigits(t, digits);
  const method = strings.receipt.pay[slip.method as keyof typeof strings.receipt.pay] ?? slip.method;
  return (
    <div dir="rtl">
      <div className="center shop">{slip.shopName}</div>
      <div className="banner">{strings.receipt.collection}</div>
      <hr className="rule" />
      <Barcode value={slip.number} />
      <div className="id">{d(slip.number)}</div>
      <div className="row small">
        <span className="num">{d(cairoTime(slip.at))}</span>
        <span>{`${strings.receipt.cashier}: ${slip.workerName}`}</span>
      </div>
      <hr className="rule" />
      <div className="name">{`${strings.receipt.customer}: ${slip.customerName}`}</div>
      <div className="row">
        <span>{strings.receipt.method}</span>
        <span>{method}</span>
      </div>
      {slip.allocations.length > 0 && (
        <>
          <div className="name">{strings.collection.onInvoices}</div>
          {slip.allocations.map((a) => (
            <div className="row small" key={a.number}>
              <span className="num">{d(a.number)}</span>
              <span className="num">{d(formatMoney(a.amount))}</span>
            </div>
          ))}
        </>
      )}
      <div className="row total">
        <span>{strings.receipt.amountPaid}</span>
        <span className="num">{d(formatMoney(slip.amount))}</span>
      </div>
      <div className="row" style={{ fontWeight: 700 }}>
        <span>{strings.receipt.balanceAfter}</span>
        <span className="num">{d(formatMoney(slip.balanceAfter))}</span>
      </div>
    </div>
  );
}
