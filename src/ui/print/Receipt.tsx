import { code128B } from '@/domain/code128';
import type { ReceiptData } from '@/domain/receipt';

import { strings } from '../strings.ar';

/** Pure: data in, markup out. Used by the real print (rendered to a static string) and by the snapshot tests. */
export function Barcode({ value }: { value: string }) {
  const code = code128B(value);
  const quiet = 10;
  let x = quiet;
  const bars = code.bars.map((bar) => {
    const at = x;
    x += bar.width;
    return bar.black ? <rect key={at} x={at} y={0} width={bar.width} height={1} fill="#000" /> : null;
  });
  return (
    <svg
      className="barcode"
      viewBox={`0 0 ${code.modules + quiet * 2} 1`}
      preserveAspectRatio="none"
      role="img"
      aria-label={value}
      shapeRendering="crispEdges"
    >
      {bars}
    </svg>
  );
}

export function Receipt({ data }: { data: ReceiptData }) {
  return (
    <div dir="rtl">
      <div className="center">
        <div className="shop">{data.shop.name}</div>
        {data.shop.phone && <div className="small">{`${strings.receipt.phone}: ${data.shop.phone}`}</div>}
        {data.shop.address && <div className="small">{data.shop.address}</div>}
      </div>
      {data.copy && <div className="banner">{strings.receipt.copy}</div>}
      <hr className="rule" />
      <Barcode value={data.barcodeValue} />
      <div className="id">{data.number}</div>
      <div className="row small">
        <span className="num">{data.dateText}</span>
        <span>{`${strings.receipt.cashier}: ${data.cashier}`}</span>
      </div>
      <hr className="rule" />
      {data.lines.map((l, i) => (
        <div className="line" key={i}>
          <div className="name">{l.name}</div>
          <div className="row">
            <span className="num">{`${l.qty} × ${l.unitPrice}`}</span>
            <span className="num">{l.total}</span>
          </div>
        </div>
      ))}
      <hr className="rule" />
      {data.discount && (
        <div className="row">
          <span>{strings.receipt.discount}</span>
          <span className="num">{data.discount}</span>
        </div>
      )}
      <div className="row total">
        <span>{strings.receipt.total}</span>
        <span className="num">{data.total}</span>
      </div>
      {data.payments.map((p, i) => (
        <div className="row" key={i}>
          <span>
            {strings.receipt.pay[p.method] +
              (p.reference ? ` (${strings.receipt.reference} ${p.reference})` : '')}
          </span>
          <span className="num">{p.amount}</span>
        </div>
      ))}
      {data.tendered && (
        <div className="row">
          <span>{strings.receipt.tendered}</span>
          <span className="num">{data.tendered}</span>
        </div>
      )}
      {data.change && (
        <div className="row" style={{ fontWeight: 700 }}>
          <span>{strings.receipt.change}</span>
          <span className="num">{data.change}</span>
        </div>
      )}
      {data.credit && (
        <>
          <hr className="rule" />
          <div className="name">{`${strings.receipt.customer}: ${data.credit.customer}`}</div>
          <div className="row">
            <span>{strings.receipt.previousBalance}</span>
            <span className="num">{data.credit.previous}</span>
          </div>
          <div className="row">
            <span>{strings.receipt.thisInvoice}</span>
            <span className="num">{data.credit.thisInvoice}</span>
          </div>
          <div className="row" style={{ fontWeight: 700 }}>
            <span>{strings.receipt.newBalance}</span>
            <span className="num">{data.credit.now}</span>
          </div>
        </>
      )}
      {data.shop.footer && (
        <>
          <hr className="rule" />
          <div className="center small">{data.shop.footer}</div>
        </>
      )}
    </div>
  );
}
