import type { InvoiceFilter } from '@/domain/invoice-filter';
import { EMPTY_FILTER, isEmptyFilter } from '@/domain/invoice-filter';
import { formatMoney, toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { strings } from '../strings.ar';

import styles from './invoiceFilters.module.css';

const t = strings.invoiceSearch;
const methodName = (k: string): string => (strings.receipt.pay as Record<string, string>)[k] ?? k;

export interface FilterOptions {
  workers: { id: string; name: string }[];
  devices: { id: string; name: string }[];
  shifts: { id: string; name: string }[];
}

/**
 * The search fields of the invoice screens. `kind` decides the wording (customer or supplier) and which fields exist
 * (device and shift only on sales). Everything is live: each change narrows the list at once.
 */
export function InvoiceFilters({
  kind,
  value,
  productText,
  onChange,
  onProductText,
  options,
  legacy = false,
}: {
  kind: 'sale' | 'purchase';
  value: InvoiceFilter;
  productText: string;
  onChange: (next: InvoiceFilter) => void;
  onProductText: (text: string) => void;
  options: FilterOptions;
  /** the old OpenSourcePOS history has no status, worker, device or shift */
  legacy?: boolean;
}) {
  const set = (patch: Partial<InvoiceFilter>): void => onChange({ ...value, ...patch });
  const money = (text: string): number | null => {
    if (!text.trim()) return null;
    const p = toPiasters(text);
    return p.ok ? p.value : null;
  };
  const methods =
    kind === 'sale'
      ? ['cash', 'credit', 'card', 'instapay', 'wallet', 'other']
      : ['cash', 'credit', 'owner', 'other'];
  const select = (
    testId: string,
    label: string,
    v: string,
    items: { id: string; name: string }[],
    key: keyof InvoiceFilter,
  ) => (
    <label className={styles.field}>
      {label}
      <select
        className="control"
        value={v}
        onChange={(e) => set({ [key]: e.target.value } as Partial<InvoiceFilter>)}
        data-testid={testId}
      >
        <option value="">{t.any}</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <details className={styles.panel} open data-testid="invoice-filters">
      <summary>{t.filters}</summary>
      <div className={styles.grid}>
        <label className={styles.field}>
          {t.number}
          <input
            className="control"
            dir="ltr"
            value={value.number}
            onChange={(e) => set({ number: e.target.value })}
            data-testid="f-number"
          />
        </label>
        <label className={styles.field}>
          {t.from}
          <input
            className="control"
            type="date"
            dir="ltr"
            value={value.from}
            onChange={(e) => set({ from: e.target.value })}
            data-testid="f-from"
          />
        </label>
        <label className={styles.field}>
          {t.to}
          <input
            className="control"
            type="date"
            dir="ltr"
            value={value.to}
            onChange={(e) => set({ to: e.target.value })}
            data-testid="f-to"
          />
        </label>
        <label className={styles.field}>
          {kind === 'sale' ? t.customer : t.supplier}
          <input
            className="control"
            value={value.party}
            onChange={(e) => set({ party: e.target.value })}
            data-testid="f-party"
          />
        </label>
        {!legacy && (
          <label className={styles.field}>
            {t.status}
            <select
              className="control"
              value={value.status}
              onChange={(e) => set({ status: e.target.value as InvoiceFilter['status'] })}
              data-testid="f-status"
            >
              <option value="">{t.statusAny}</option>
              <option value="posted">{t.statusPosted}</option>
              <option value="voided">{t.statusVoided}</option>
              <option value="returned">{t.statusReturned}</option>
            </select>
          </label>
        )}
        <label className={styles.field}>
          {t.method}
          <select
            className="control"
            value={value.method}
            onChange={(e) => set({ method: e.target.value as InvoiceFilter['method'] })}
            data-testid="f-method"
          >
            <option value="">{t.methodAny}</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {methodName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t.minAmount}
          <input
            className="control"
            dir="ltr"
            inputMode="decimal"
            defaultValue={value.minAmount === null ? '' : formatMoney(value.minAmount)}
            key={`min-${value.minAmount === null}`}
            onChange={(e) => set({ minAmount: money(e.target.value) })}
            data-testid="f-min"
          />
        </label>
        <label className={styles.field}>
          {t.maxAmount}
          <input
            className="control"
            dir="ltr"
            inputMode="decimal"
            defaultValue={value.maxAmount === null ? '' : formatMoney(value.maxAmount)}
            key={`max-${value.maxAmount === null}`}
            onChange={(e) => set({ maxAmount: money(e.target.value) })}
            data-testid="f-max"
          />
        </label>
        <label className={styles.field}>
          {t.product}
          <input
            className="control"
            value={productText}
            onChange={(e) => onProductText(e.target.value)}
            data-testid="f-product"
          />
        </label>
        {!legacy && select('f-worker', t.worker, value.workerId, options.workers, 'workerId')}
        {!legacy &&
          kind === 'sale' &&
          select('f-device', t.device, value.deviceId, options.devices, 'deviceId')}
        {!legacy && kind === 'sale' && select('f-shift', t.shift, value.shiftId, options.shifts, 'shiftId')}
      </div>
      <div className={styles.actions}>
        <ActionButton
          label={t.reset}
          variant="ghost"
          disabled={isEmptyFilter(value) && productText === ''}
          onClick={() => {
            onChange(EMPTY_FILTER);
            onProductText('');
          }}
          testId="f-reset"
        />
      </div>
    </details>
  );
}

export const statusChipClass = (status: 'posted' | 'voided', hasReturn: boolean): string =>
  status === 'voided'
    ? `${styles.chip} ${styles.voided}`
    : hasReturn
      ? `${styles.chip} ${styles.returned}`
      : `${styles.chip}`;
