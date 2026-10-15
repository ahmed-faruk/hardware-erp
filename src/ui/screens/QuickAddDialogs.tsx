import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { addSupplier } from '@/db/commands/save-master';
import { saveProduct } from '@/db/commands/save-product';
import type { Product } from '@/db/types';
import { formatMoney, toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { strings } from '../strings.ar';

import { errorWord } from './useSaver';
import styles from './purchase.module.css';

const t = strings.purchases;

/** New product from inside the invoice: name, barcode, unit, category (and the sale price for whoever may set prices). The cost comes from the line. */
export function QuickAddProduct({
  open,
  barcode,
  onClose,
  onAdded,
}: {
  open: boolean;
  barcode: string;
  onClose: () => void;
  onAdded: (product: Product) => void;
}) {
  return (
    <Dialog title={t.newProduct} open={open} onClose={onClose}>
      <ProductBody barcode={barcode} onClose={onClose} onAdded={onAdded} />
    </Dialog>
  );
}

function ProductBody({
  barcode,
  onClose,
  onAdded,
}: {
  barcode: string;
  onClose: () => void;
  onAdded: (product: Product) => void;
}) {
  const { db } = useServices();
  const { context, can } = useSession();
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const [name, setName] = useState('');
  const [code, setCode] = useState(barcode);
  const [unit, setUnit] = useState<string>(strings.common.pieces);
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPrice = can('editPrices') === 'yes';

  const save = async (): Promise<void> => {
    if (!context) return;
    if (!name.trim() || !unit.trim()) return setError(strings.common.required);
    const fields: Record<string, unknown> = {
      name,
      baseUnitName: unit,
      categoryId: categoryId || null,
      qtyDecimals: 0,
    };
    if (canPrice && price.trim()) {
      const p = toPiasters(price);
      if (!p.ok) return setError(strings.errors.invalid);
      fields.price = p.value;
    }
    setBusy(true);
    setError(null);
    const r = await saveProduct(context, { fields, barcodes: code.trim() ? [code.trim()] : [] });
    if (!r.ok) {
      setBusy(false);
      return setError(errorWord(r.code));
    }
    const product = await db.products.get(r.id);
    setBusy(false);
    if (product) onAdded(product);
  };

  return (
    <div className={styles.pay}>
      <FormField label={strings.products.name}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="qa-name"
          />
        )}
      </FormField>
      <FormField label={strings.products.barcode}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="qa-barcode"
          />
        )}
      </FormField>
      <div className={styles.pair}>
        <FormField label={strings.products.baseUnit}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              data-testid="qa-unit"
            />
          )}
        </FormField>
        <FormField label={strings.products.category}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              data-testid="qa-category"
            >
              <option value="">{strings.common.none}</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      {canPrice ? (
        <FormField label={`${strings.products.price} (${strings.common.egp})`}>
          {(id) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              inputMode="decimal"
              value={price}
              placeholder={formatMoney(0)}
              onChange={(e) => setPrice(e.target.value)}
              data-testid="qa-price"
            />
          )}
        </FormField>
      ) : (
        <p className={styles.hint}>{t.newProductNoPrice}</p>
      )}
      {error && <BigAlert tone="danger" word={error} />}
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <ActionButton
          label={t.addToInvoice}
          variant="ok"
          loading={busy}
          onClick={() => void save()}
          testId="qa-save"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onClose} />
      </div>
    </div>
  );
}

/** New supplier: name and phone, then it is the invoice's supplier. */
export function QuickAddSupplier({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string, name: string) => void;
}) {
  return (
    <Dialog title={t.newSupplier} open={open} onClose={onClose}>
      <SupplierBody onClose={onClose} onAdded={onAdded} />
    </Dialog>
  );
}

function SupplierBody({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (id: string, name: string) => void;
}) {
  const { context } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    if (!context) return;
    const r = await addSupplier(context, { name, phone: phone.trim() || null });
    if (!r.ok) return setError(errorWord(r.code));
    onAdded(r.id, name.trim());
  };
  return (
    <div className={styles.pay}>
      <FormField label={strings.purchases.supplier}>
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="qs-name"
          />
        )}
      </FormField>
      <FormField label={strings.purchases.supplierPhone}>
        {(id) => (
          <input
            id={id}
            className="control"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            data-testid="qs-phone"
          />
        )}
      </FormField>
      {error && <BigAlert tone="danger" word={error} />}
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <ActionButton label={strings.common.save} variant="ok" onClick={() => void save()} testId="qs-save" />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onClose} />
      </div>
    </div>
  );
}
