import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postStockAdjustment } from '@/db/commands/purchasing';
import type { Product } from '@/db/types';
import { ADJUSTMENT_REASONS, type AdjustmentReason } from '@/domain/adjustment';
import { formatQty, toMilli } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { ProductPicker } from '../components/ProductPicker';
import { Skeleton } from '../components/Skeleton';
import { useApproval } from '../cashier/ApprovalDialog';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

interface Row {
  product: Product;
  system: number;
  counted: number | null;
}

/** INV-06: count a product, say why the number differs, save. A big value asks for the manager's PIN. */
export function StockScreen() {
  const { db } = useServices();
  const { context } = useSession();
  const warehouse = useLiveQuery(
    async () => (await db.warehouses.filter((w) => w.kind === 'main' && !w.deletedAt).first()) ?? null,
    [db],
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [reason, setReason] = useState<AdjustmentReason>('count');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { ask, dialog } = useApproval();
  if (warehouse === undefined) return <Skeleton />;
  if (!warehouse) return <BigAlert tone="warn" word={strings.purchases.noWarehouse} />;

  const add = async (product: Product): Promise<void> => {
    if (rows.some((r) => r.product.id === product.id)) return;
    const system = (await db.stockBalances.toArray())
      .filter((b) => b.productId === product.id)
      .reduce((a, b) => a + b.qty, 0);
    setRows((r) => [...r, { product, system, counted: system }]);
  };
  const diff = (r: Row): number => (r.counted === null ? 0 : r.counted - r.system);
  const changed = rows.filter((r) => diff(r) !== 0);

  const save = async (): Promise<void> => {
    if (!context || changed.length === 0) return;
    setError(null);
    const base = {
      warehouseId: warehouse.id,
      reason,
      lines: changed.map((r) => ({ productId: r.product.id, qtyDeltaMilli: diff(r) })),
    };
    let r = await postStockAdjustment(context, base);
    if (!r.ok && r.code === 'APPROVAL_REQUIRED') {
      const token = await ask('stockAdjustment');
      if (token) r = await postStockAdjustment(context, { ...base, approvalTokens: [token] });
    }
    if (r.ok) {
      setRows([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else setError(r.code === 'APPROVAL_REQUIRED' ? strings.stock.needsManager : strings.stock.failed);
  };

  return (
    <section>
      <h1 className={styles.title}>{strings.stock.title}</h1>
      <div className={styles.form}>
        <div className={styles.section}>
          <ProductPicker onPick={(p) => void add(p)} label={strings.stock.pick} />
          <FormField label={strings.stock.reason}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={reason}
                onChange={(e) => setReason(e.target.value as AdjustmentReason)}
                data-testid="adjust-reason"
              >
                {ADJUSTMENT_REASONS.map((x) => (
                  <option key={x} value={x}>
                    {strings.stock.reasons[x]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        {rows.length === 0 && <BigAlert tone="warn" word={strings.stock.empty} sound={false} />}
        {rows.map((r) => (
          <div key={r.product.id} className={styles.section} data-testid="adjust-line">
            <h2>{r.product.name}</h2>
            <p>{`${strings.stock.system}: ${formatQty(r.system)}`}</p>
            <NumberField
              label={strings.stock.counted}
              value={r.counted}
              onChange={(v) =>
                setRows((x) => x.map((y) => (y.product.id === r.product.id ? { ...y, counted: v } : y)))
              }
              parse={toMilli}
              format={formatQty}
              required
            />
            <p data-testid="adjust-diff">
              {diff(r) === 0 ? strings.stock.same : `${strings.stock.difference}: ${formatQty(diff(r))}`}
            </p>
            <ActionButton
              label={strings.actions.remove}
              icon={Trash2}
              variant="ghost"
              onClick={() => setRows((x) => x.filter((y) => y.product.id !== r.product.id))}
            />
          </div>
        ))}
        {error && <BigAlert tone="danger" word={error} />}
        {saved && <BigAlert tone="ok" word={strings.stock.saved} />}
        <div className={styles.actions}>
          <ActionButton
            label={strings.stock.save}
            variant="ok"
            disabled={changed.length === 0}
            onClick={() => void save()}
            testId="save-adjustment"
          />
        </div>
      </div>
      {dialog}
    </section>
  );
}
