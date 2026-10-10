import type { PurchaseDocumentData } from '@/db/purchase-document';
import { formatMoney, formatQty } from '@/domain/money';
import { cairoTime } from '@/domain/receipt';

import { strings } from '../strings.ar';

/** A4 purchase invoice: what came in, at what cost, and how it was paid. */
export function PurchaseDocument({ doc }: { doc: PurchaseDocumentData }) {
  return (
    <div dir="rtl">
      <h1>{doc.shopName}</h1>
      <h2>{`${strings.nav.purchases} ${doc.number}`}</h2>
      <p>{`${strings.purchases.supplier}: ${doc.supplierName} — ${cairoTime(doc.issuedAt)}`}</p>
      <table>
        <thead>
          <tr>
            <th>{strings.products.title}</th>
            <th>{strings.purchases.qty}</th>
            <th>{strings.purchases.unitCost}</th>
            <th>{strings.purchases.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              <td className="num">{formatQty(l.qtyMilli)}</td>
              <td className="num">{formatMoney(l.unitCost)}</td>
              <td className="num">{formatMoney(l.net)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={3}>{strings.purchases.total}</td>
            <td className="num">{formatMoney(doc.total)}</td>
          </tr>
        </tbody>
      </table>
      <h3>{strings.sell.pay}</h3>
      <table>
        <tbody>
          {doc.payments.map((p, i) => (
            <tr key={i}>
              <td>{strings.receipt.pay[p.method as keyof typeof strings.receipt.pay] ?? p.method}</td>
              <td className="num">{formatMoney(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
