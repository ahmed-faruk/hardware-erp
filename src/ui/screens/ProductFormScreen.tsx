import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveProduct } from '@/db/commands/save-product';
import type { Barcode, Product, ProductUnit } from '@/db/types';
import { formatMoney, formatQty, toMilli, toPiasters } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { IconPicker } from '../components/IconPicker';
import { NumberField } from '../components/NumberField';
import { Skeleton } from '../components/Skeleton';
import { IconView } from '../icons/IconView';
import { navigate } from '../router';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

interface Loaded {
  product: Product | null;
  barcodes: Barcode[];
  unit: ProductUnit | null;
}

export function ProductFormScreen({ id }: { id: string }) {
  const { db } = useServices();
  const loaded = useLiveQuery(async (): Promise<Loaded> => {
    if (id === 'new') return { product: null, barcodes: [], unit: null };
    const product = (await db.products.get(id)) ?? null;
    const barcodes = (await db.barcodes.where('productId').equals(id).toArray()).filter((b) => !b.deletedAt);
    const unit =
      (await db.productUnits.where('productId').equals(id).toArray()).find((u) => !u.deletedAt) ?? null;
    return { product, barcodes, unit };
  }, [db, id]);
  if (!loaded) return <Skeleton />;
  return <ProductForm key={id} loaded={loaded} />;
}

function ProductForm({ loaded }: { loaded: Loaded }) {
  const { db } = useServices();
  const { context, worker } = useSession();
  const { product } = loaded;
  const isManager = worker?.role === 'manager';
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.deletedAt && s.active).toArray(), [db]);

  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [baseUnitName, setBaseUnitName] = useState(product?.baseUnitName ?? strings.common.pieces);
  const [decimals, setDecimals] = useState(product?.qtyDecimals ?? 0);
  const [price, setPrice] = useState<number | null>(product?.price ?? 0);
  const [wholesale, setWholesale] = useState<number | null>(product?.priceWholesale ?? null);
  const [craftsman, setCraftsman] = useState<number | null>(product?.priceCraftsman ?? null);
  const [contractor, setContractor] = useState<number | null>(product?.priceContractor ?? null);
  const [cost, setCost] = useState<number | null>(product?.unitCost ?? 0);
  const [reorder, setReorder] = useState<number | null>(product?.reorderLevel ?? 0);
  const [supplierId, setSupplierId] = useState(product?.defaultSupplierId ?? '');
  const [active, setActive] = useState(product?.active ?? true);
  const [plu, setPlu] = useState((product?.extraFields as { plu?: string | null } | null)?.plu ?? '');
  const [icon, setIcon] = useState<string | null>(
    (product?.extraFields as { icon?: string } | null)?.icon ?? null,
  );
  const [codes, setCodes] = useState<string[]>(
    loaded.barcodes.length ? loaded.barcodes.map((b) => b.code) : [''],
  );
  const [packOn, setPackOn] = useState(!!loaded.unit);
  const [packName, setPackName] = useState(loaded.unit?.name ?? '');
  const [packFactor, setPackFactor] = useState<number | null>(loaded.unit?.factor ?? null);
  const [packPrice, setPackPrice] = useState<number | null>(loaded.unit?.price ?? null);
  const [picking, setPicking] = useState(false);
  const quickIds = useLiveQuery(
    async () => ((await db.deviceSettings.get('quickGrid'))?.value as string[] | undefined) ?? [],
    [db],
  );
  const [pinned, setPinned] = useState<boolean | null>(null);
  const isPinned = pinned ?? (product ? (quickIds ?? []).includes(product.id) : false);
  const [missing, setMissing] = useState(false);

  const saver = useSaver(() => navigate('products'));

  const submit = (): void => {
    if (!context) return;
    const packBad = packOn && (!packName.trim() || !packFactor || packFactor <= 0);
    if (!name.trim() || !baseUnitName.trim() || packBad) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const fields: Record<string, unknown> = {
      name,
      categoryId: categoryId || null,
      baseUnitName,
      qtyDecimals: decimals,
      reorderLevel: reorder ?? 0,
      defaultSupplierId: supplierId || null,
      active,
      extraFields: { icon, plu: /^\d{5}$/.test(plu) ? plu : null },
    };
    if (isManager)
      Object.assign(fields, {
        price: price ?? 0,
        unitCost: cost ?? 0,
        priceWholesale: wholesale,
        priceCraftsman: craftsman,
        priceContractor: contractor,
      });
    void saver.run(async () => {
      const r = await saveProduct(context, {
        id: product?.id,
        baseVersion: product?.version,
        fields,
        barcodes: codes.map((c) => c.trim()).filter(Boolean),
        packUnit: packOn ? { name: packName.trim(), factorMilli: packFactor ?? 0, price: packPrice } : null,
      });
      if (r.ok) {
        // the quick grid is a list of product ids kept on THIS device only (POS-02)
        const current = ((await db.deviceSettings.get('quickGrid'))?.value as string[] | undefined) ?? [];
        const next = isPinned ? [...new Set([...current, r.id])] : current.filter((x) => x !== r.id);
        await db.deviceSettings.put({ key: 'quickGrid', value: next });
      }
      return r;
    });
  };

  return (
    <section>
      <h1 className={styles.title}>{product ? strings.products.editProduct : strings.products.newProduct}</h1>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormField
          label={strings.products.name}
          error={missing && !name.trim() ? strings.common.required : null}
        >
          {(id, d) => (
            <input
              id={id}
              className="control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-describedby={d}
              data-testid="product-name"
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
        {isManager && (
          <NumberField
            label={strings.products.price}
            suffix={strings.common.egp}
            value={price}
            onChange={setPrice}
            parse={toPiasters}
            format={formatMoney}
            required
          />
        )}
        <FormField label={strings.products.plu}>
          {(id) => (
            <input
              id={id}
              className="control"
              dir="ltr"
              inputMode="numeric"
              maxLength={5}
              value={plu}
              onChange={(e) => setPlu(e.target.value.replace(/\D/g, ''))}
              data-testid="product-plu"
            />
          )}
        </FormField>
        {isManager &&
          (
            [
              [strings.products.wholesale, wholesale, setWholesale],
              [strings.products.craftsman, craftsman, setCraftsman],
              [strings.products.contractor, contractor, setContractor],
            ] as const
          ).map(([label, value, set]) => (
            <NumberField
              key={label}
              label={`${strings.products.priceLists}: ${label}`}
              suffix={strings.common.egp}
              value={value}
              onChange={set}
              parse={toPiasters}
              format={formatMoney}
            />
          ))}
        {isManager && (
          <NumberField
            label={strings.products.cost}
            suffix={strings.common.egp}
            value={cost}
            onChange={setCost}
            parse={toPiasters}
            format={formatMoney}
          />
        )}
        <FormField label={strings.products.baseUnit}>
          {(id) => (
            <input
              id={id}
              className="control"
              value={baseUnitName}
              onChange={(e) => setBaseUnitName(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={strings.products.decimals}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <NumberField
          label={strings.products.reorder}
          value={reorder}
          onChange={setReorder}
          parse={toMilli}
          format={formatQty}
        />
        <FormField label={strings.products.supplier}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">{strings.common.none}</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <div className={styles.section}>
          <h2>{strings.products.barcodes}</h2>
          {codes.map((code, i) => (
            <div key={i} className={styles.row}>
              <FormField label={`${strings.products.barcode} ${i + 1}`}>
                {(id) => (
                  <input
                    id={id}
                    className="control"
                    dir="ltr"
                    value={code}
                    onChange={(e) => setCodes(codes.map((c, j) => (j === i ? e.target.value : c)))}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                    data-testid={`barcode-${i}`}
                  />
                )}
              </FormField>
              <ActionButton
                label={strings.actions.remove}
                icon={Trash2}
                variant="ghost"
                onClick={() => setCodes(codes.length > 1 ? codes.filter((_, j) => j !== i) : [''])}
              />
            </div>
          ))}
          <div>
            <ActionButton
              label={strings.products.addBarcode}
              icon={Plus}
              variant="ghost"
              onClick={() => setCodes([...codes, ''])}
            />
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={packOn}
              onChange={(e) => setPackOn(e.target.checked)}
              data-testid="pack-on"
            />
            {strings.products.packUnit}
          </label>
          {packOn && (
            <>
              <FormField
                label={strings.products.packName}
                error={missing && !packName.trim() ? strings.common.required : null}
              >
                {(id) => (
                  <input
                    id={id}
                    className="control"
                    value={packName}
                    onChange={(e) => setPackName(e.target.value)}
                  />
                )}
              </FormField>
              <NumberField
                label={strings.products.packFactor}
                value={packFactor}
                onChange={setPackFactor}
                parse={toMilli}
                format={formatQty}
                required
              />
              {isManager && (
                <NumberField
                  label={strings.products.packPrice}
                  suffix={strings.common.egp}
                  value={packPrice}
                  onChange={setPackPrice}
                  parse={toPiasters}
                  format={formatMoney}
                />
              )}
            </>
          )}
        </div>

        <div className={styles.section}>
          <h2>{strings.products.icon}</h2>
          <div className={styles.row}>
            <span className={styles.tile}>
              <IconView iconKey={icon} size={24} aria-hidden="true" />
            </span>
            <ActionButton
              label={strings.products.chooseIcon}
              variant="ghost"
              onClick={() => setPicking(true)}
              testId="choose-icon"
            />
          </div>
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {strings.common.active}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setPinned(e.target.checked)}
            data-testid="pin-quick"
          />
          {strings.products.pinQuick}
        </label>

        {saver.error && (
          <div className={styles.span}>
            <BigAlert tone="danger" word={saver.error} />
          </div>
        )}
        <div className={styles.actions}>
          <ActionButton
            label={strings.common.save}
            icon={Save}
            type="submit"
            variant="ok"
            loading={saver.busy}
            testId="save-product"
          />
          <ActionButton label={strings.common.cancel} variant="ghost" onClick={() => navigate('products')} />
        </div>
      </form>
      <Dialog title={strings.products.icon} open={picking} onClose={() => setPicking(false)}>
        <IconPicker
          value={icon}
          onChange={(key) => {
            setIcon(key);
            setPicking(false);
          }}
        />
      </Dialog>
    </section>
  );
}
