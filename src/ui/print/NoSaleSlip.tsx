import type { NoSaleSlipData } from '@/db/commands/receipts';

import { strings } from '../strings.ar';

/** Printing this slip is what opens the cash drawer (driver option "open drawer on print"), and it leaves a paper trail. */
export function NoSaleSlip({
  shopName,
  slip,
  dateText,
}: {
  shopName: string;
  slip: NoSaleSlipData;
  dateText: string;
}) {
  return (
    <div dir="rtl">
      <div className="center shop">{shopName}</div>
      <div className="banner">{strings.receipt.noSale}</div>
      <hr className="rule" />
      <div className="row">
        <span>{strings.receipt.reason}</span>
        <span>{strings.receipt.noSaleReasons[slip.reason]}</span>
      </div>
      <div className="row">
        <span>{strings.receipt.worker}</span>
        <span>{slip.workerName}</span>
      </div>
      <div className="row small">
        <span className="num">{dateText}</span>
      </div>
    </div>
  );
}
