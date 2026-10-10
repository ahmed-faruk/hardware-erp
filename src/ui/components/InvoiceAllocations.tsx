import type { OpenInvoice } from '@/db/allocations';
import { formatMoney } from '@/domain/money';

import { strings } from '../strings.ar';

/** FIN-06 / PUR-06: tick the invoices a payment settles; what is left of the amount stays on account. */
export function InvoiceAllocations({
  open,
  checked,
  allocated,
  onToggle,
  digits = (t) => t,
}: {
  open: OpenInvoice[];
  checked: string[];
  /** amount already given to each checked invoice, by invoice id */
  allocated: Map<string, number>;
  onToggle: (invoiceId: string) => void;
  digits?: (t: string) => string;
}) {
  if (open.length === 0) return null;
  return (
    <div data-testid="allocations">
      <p style={{ margin: 0, fontWeight: 700 }}>{strings.collection.onInvoices}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {open.map((o) => (
          <li key={o.invoiceId}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
              <input
                type="checkbox"
                checked={checked.includes(o.invoiceId)}
                onChange={() => onToggle(o.invoiceId)}
                data-testid={`alloc-${o.number}`}
              />
              <span dir="ltr">{digits(o.number)}</span>
              <span>{`${strings.collection.open}: ${digits(formatMoney(o.open))}`}</span>
              {allocated.get(o.invoiceId) ? (
                <strong>{digits(formatMoney(allocated.get(o.invoiceId)!))}</strong>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
