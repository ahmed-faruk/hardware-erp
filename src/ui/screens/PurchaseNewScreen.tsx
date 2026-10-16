import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { postPurchase } from '@/db/commands/purchasing';
import { findByBarcode } from '@/db/lookup';
import { clearDraft, loadDraft, saveDraft, type PurchaseDraft } from '@/db/purchase-draft';
import { costForUnit, lineHints } from '@/db/purchase-hints';
import { searchProducts } from '@/db/search';
import type { Product, ProductUnit } from '@/db/types';
import { formatMoney, toPiasters } from '@/domain/money';
import { allocateInvoiceDiscount, computePurchase, splitPurchasePayment } from '@/domain/purchase';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { Combobox } from '../components/Combobox';
import { FormField } from '../components/FormField';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import { navigate } from '../router';
import { strings } from '../strings.ar';

import { PurchaseLines, type PurchaseRow } from './PurchaseLines';
import { QuickAddProduct, QuickAddSupplier } from './QuickAddDialogs';
import { useBasics } from './purchaseParts';
import styles from './purchase.module.css';

const t = strings.purchases;
type PayMode = 'cash' | 'credit' | 'mix';

const unitCost = (hint: number | null, current: number, unit: ProductUnit | null): number | null => {
  const base = hint ?? (current > 0 ? current : null);
  return base === null ? null : costForUnit(base, unit?.factor ?? 1000);
};

/** The new purchase invoice, on a page of its own: supplier, scan bar, lines, then the money. A draft is kept while you type. */
export function PurchaseNewScreen() {
  const { db } = useServices();
  const session = useSession();
  const { context, can } = session;
  const basics = useBasics();
  const canPrice = can('editPrices') === 'yes';
  const mayPayOwner = can('payFromOwner') === 'yes';
  const [supplierId, setSupplierId] = useState('');
  const [supplierText, setSupplierText] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [discount, setDiscount] = useState(0);
  const [mode, setMode] = useState<PayMode>('mix');
  const [paid, setPaid] = useState<number | null>(null);
  const [ownerPaid, setOwnerPaid] = useState<number | null>(null);
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [quickProduct, setQuickProduct] = useState<string | null>(null);
  const [quickSupplier, setQuickSupplier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  // set once the invoice is saved or the draft discarded: no late autosave may bring the draft back
  const draftOff = useRef(false);
  const balances = useLiveQuery(() => db.partyBalances.toArray(), [db]);

  const makeRow = useCallback(
    async (product: Product, unit: ProductUnit | null, isNew = false): Promise<PurchaseRow> => {
      const hints = await lineHints(db, product.id);
      const factor = unit?.factor ?? 1000;
      const lastCost = hints.lastCostPerBase === null ? null : costForUnit(hints.lastCostPerBase, factor);
      return {
        key: crypto.randomUUID(),
        product,
        unit,
        qty: 1000,
        cost: unitCost(hints.lastCostPerBase, hints.currentCost, unit),
        price: null,
        lastCost,
        hints,
        isNew,
      };
    },
    [db],
  );

  // restore the draft of this device once
  useEffect(() => {
    let live = true;
    void (async () => {
      const d = await loadDraft(db);
      if (!live) return;
      if (d) {
        const products = await db.products.bulkGet(d.rows.map((r) => r.productId));
        const units = await db.productUnits.bulkGet(d.rows.map((r) => r.unitId ?? ''));
        const restored: PurchaseRow[] = [];
        for (const [i, r] of d.rows.entries()) {
          const product = products[i];
          if (!product || product.deletedAt) continue; // an archived product drops out of a draft
          const unit = units[i] && !units[i]!.deletedAt ? units[i]! : null;
          const base = await makeRow(product, unit);
          restored.push({ ...base, qty: r.qty, cost: r.cost, price: r.price });
        }
        const supplier = d.supplierId ? await db.suppliers.get(d.supplierId) : undefined;
        if (!live) return;
        setRows(restored);
        if (supplier && !supplier.deletedAt) {
          setSupplierId(supplier.id);
          setSupplierText(supplier.name);
        }
        setSupplierRef(d.supplierRef);
        setDiscount(d.discount);
        setMode(d.mode);
        setPaid(d.paid);
        setOwnerPaid(d.ownerPaid);
        setDraftAt(d.savedAt || null);
      }
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [db, makeRow]);

  // keep the draft (this device only, nothing is synced)
  useEffect(() => {
    if (!ready) return;
    draftOff.current = false;
    const timer = setTimeout(() => {
      if (draftOff.current) return;
      const draft: PurchaseDraft = {
        supplierId,
        supplierRef,
        discount,
        mode,
        paid,
        ownerPaid,
        rows: rows.map((r) => ({
          productId: r.product.id,
          unitId: r.unit?.id ?? null,
          qty: r.qty ?? 1000,
          cost: r.cost,
          price: r.price,
        })),
        savedAt: new Date().toISOString(),
      };
      void saveDraft(db, draft).then((stored) => setDraftAt(stored ? draft.savedAt : null));
    }, 400);
    return () => clearTimeout(timer);
  }, [db, ready, supplierId, supplierRef, discount, mode, paid, ownerPaid, rows]);

  if (!basics || !ready) return <Skeleton />;
  if (!basics.warehouse) return <BigAlert tone="warn" word={t.noWarehouse} />;

  const supplier = basics.suppliers.find((s) => s.id === supplierId);
  const owed = supplierId
    ? -(balances?.find((b) => b.partyType === 'supplier' && b.partyId === supplierId)?.amount ?? 0)
    : 0;

  // money: lines at their cost, the invoice discount spread over them, then the payment
  const valid = rows.length > 0 && rows.every((r) => r.qty && r.qty > 0 && r.cost !== null);
  const gross = valid
    ? computePurchase(rows.map((r) => ({ qtyMilli: r.qty!, unitCost: r.cost!, discount: 0 })))
    : null;
  const discountClamped = gross ? Math.min(discount, gross.subtotal) : 0;
  const lineDiscounts = gross
    ? allocateInvoiceDiscount(
        gross.lines.map((l) => l.grossAmount),
        discountClamped,
      )
    : [];
  const totals = gross
    ? computePurchase(
        rows.map((r, i) => ({ qtyMilli: r.qty!, unitCost: r.cost!, discount: lineDiscounts[i] ?? 0 })),
      )
    : null;
  const total = totals?.total ?? 0;
  const ownerAmount = mode === 'mix' && mayPayOwner ? (ownerPaid ?? 0) : 0;
  const cashPaid =
    mode === 'cash'
      ? total
      : mode === 'credit'
        ? 0
        : Math.min(paid ?? Math.max(0, total - ownerAmount), total);
  const split = splitPurchasePayment(total, cashPaid, mode === 'mix' ? ownerAmount : 0);
  const rowTotals = totals ? totals.lines.map((l) => l.netAmount) : rows.map(() => 0);

  const patch = (key: string, p: Partial<PurchaseRow>): void =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const addProduct = async (product: Product, unit: ProductUnit | null, isNew = false): Promise<void> => {
    const row = await makeRow(product, unit, isNew);
    // decided on the latest list, so two quick scans of the same item add one to the quantity and never make two lines
    setRows((list) => {
      const same = list.find(
        (r) => r.product.id === product.id && (r.unit?.id ?? null) === (unit?.id ?? null),
      );
      return same ? list.map((r) => (r === same ? { ...r, qty: (r.qty ?? 0) + 1000 } : r)) : [...list, row];
    });
  };

  const submitScan = async (): Promise<void> => {
    const text = scan.trim();
    if (!text) return;
    // the field is emptied at once, so a scanner that sends the next code right away is never lost
    setScan('');
    setScanError(null);
    const found = await findByBarcode(db, text);
    if (found) return addProduct(found.product, found.unit);
    const [first] = await searchProducts(db, text, { limit: 1 });
    if (first) return addProduct(first, null);
    // a code nobody knows: offer the new-product dialog with the barcode filled in
    if (/^\d{6,}$/.test(text) && can('addProduct') === 'yes') return setQuickProduct(text);
    setScanError(t.unknownItem);
  };

  const chooseSupplier = (text: string): void => {
    setSupplierText(text);
    const match = basics.suppliers.find((s) => s.name.trim().toLowerCase() === text.trim().toLowerCase());
    setSupplierId(match?.id ?? '');
  };

  const save = async (): Promise<void> => {
    if (!context || !supplierId || !totals || !gross) return;
    if (cashPaid > 0 && !basics.safe) return setError(t.noSafe);
    if (!split) return setError(t.ownerTooMuch);
    setBusy(true);
    setError(null);
    const payments = [
      ...(cashPaid > 0
        ? [{ method: 'cash' as const, amount: cashPaid, cashAccountId: basics.safe!.id }]
        : []),
      ...(split.owner > 0 ? [{ method: 'owner' as const, amount: split.owner }] : []),
      ...(split.credit > 0 ? [{ method: 'credit' as const, amount: split.credit }] : []),
    ];
    const r = await postPurchase(context, {
      supplierId,
      warehouseId: basics.warehouse!.id,
      supplierRef: supplierRef.trim() || null,
      lines: rows.map((x, i) => ({
        productId: x.product.id,
        productUnitId: x.unit?.id ?? null,
        unitFactorMilli: x.unit?.factor ?? 1000,
        qtyMilli: x.qty!,
        unitCost: x.cost!,
        discount: lineDiscounts[i] ?? 0,
        newSalePrice: canPrice ? x.price : null,
      })),
      payments,
    });
    setBusy(false);
    if (!r.ok) return setError(r.code === 'E_FORBIDDEN' ? strings.forbidden : t.failed);
    draftOff.current = true;
    await clearDraft(db);
    navigate('purchases');
  };

  const discard = async (): Promise<void> => {
    draftOff.current = true;
    await clearDraft(db);
    setRows([]);
    setSupplierId('');
    setSupplierText('');
    setSupplierRef('');
    setDiscount(0);
    setMode('mix');
    setPaid(null);
    setOwnerPaid(null);
    setDraftAt(null);
  };

  return (
    <section className={styles.screen}>
      <div className={styles.topbar}>
        <h1 style={{ margin: 0 }}>{t.newPurchase}</h1>
        <span className={styles.draft} data-testid="purchase-draft">
          {draftAt ? (
            <>
              <span className={styles.dot} aria-hidden="true" />
              {t.draftSaved} — {t.draftHint}
            </>
          ) : null}
        </span>
        <ActionButton
          label={t.backToList}
          icon={ArrowRight}
          variant="ghost"
          onClick={() => navigate('purchases')}
          testId="purchase-back"
        />
      </div>

      <div className={styles.grid}>
        <div style={{ display: 'grid', gap: 'var(--space-4)', minInlineSize: 0 }}>
          <div className={styles.card}>
            <div className={styles.supplier}>
              <FormField label={t.supplier}>
                {(id) => (
                  <Combobox
                    id={id}
                    value={supplierText}
                    options={basics.suppliers.map((x) => ({ id: x.id, label: x.name }))}
                    onText={chooseSupplier}
                    onPick={(o) => {
                      setSupplierId(o.id);
                      setSupplierText(o.label);
                    }}
                    placeholder={t.pickSupplier}
                    testId="purchase-supplier"
                  />
                )}
              </FormField>
              {can('addSupplier') === 'yes' && (
                <ActionButton
                  label={`+ ${t.newSupplier}`}
                  variant="ghost"
                  onClick={() => setQuickSupplier(true)}
                  testId="purchase-new-supplier"
                />
              )}
            </div>
            <div className={styles.pair}>
              <div className={styles.balance} data-testid="supplier-balance">
                {supplier ? (
                  owed >= 0 ? (
                    <>
                      {t.supplierBalance}: <b className={styles.owed}>{formatMoney(owed)}</b>
                    </>
                  ) : (
                    <>
                      {t.supplierBalanceCredit}: <b>{formatMoney(-owed)}</b>
                    </>
                  )
                ) : (
                  t.pickSupplierFirst
                )}
              </div>
              <FormField label={t.supplierRef}>
                {(id) => (
                  <input
                    id={id}
                    className="control"
                    dir="ltr"
                    value={supplierRef}
                    maxLength={60}
                    onChange={(e) => setSupplierRef(e.target.value)}
                    data-testid="purchase-supplier-ref"
                  />
                )}
              </FormField>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.scan}>
              <FormField label={t.scanLabel}>
                {(id) => (
                  <input
                    id={id}
                    ref={scanRef}
                    className={`control ${styles.scanInput}`}
                    value={scan}
                    autoComplete="off"
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitScan();
                      }
                    }}
                    data-testid="purchase-scan"
                  />
                )}
              </FormField>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <ActionButton
                  label={t.scanAdd}
                  onClick={() => void submitScan()}
                  testId="purchase-scan-add"
                />
                {can('addProduct') === 'yes' && (
                  <ActionButton
                    label={`+ ${t.newProductButton}`}
                    variant="ghost"
                    onClick={() => setQuickProduct('')}
                    testId="purchase-new-product"
                  />
                )}
              </div>
            </div>
            <div className={styles.hint}>{t.scanHint}</div>
            {scanError && <BigAlert tone="warn" word={scanError} sound={false} />}
            {rows.length === 0 ? (
              <BigAlert tone="warn" word={t.empty} sound={false} />
            ) : (
              <PurchaseLines
                rows={rows}
                lineTotals={rowTotals}
                canPrice={canPrice}
                onPatch={patch}
                onRemove={(key) => setRows((list) => list.filter((r) => r.key !== key))}
                onDone={() => scanRef.current?.focus()}
              />
            )}
          </div>
        </div>

        <aside className={`${styles.card} ${styles.soft}`} aria-label={t.payTitle}>
          <h2 className={styles.cardTitle}>{t.itemsTotal}</h2>
          <div className={styles.totals}>
            <div>
              <span>{t.itemsTotal}</span>
              <span className={styles.num} data-testid="purchase-gross">
                {formatMoney(gross?.subtotal ?? 0)}
              </span>
            </div>
            <NumberField
              label={t.discount}
              value={discount}
              onChange={(v) => setDiscount(v ?? 0)}
              parse={toPiasters}
              format={formatMoney}
            />
            <div className={styles.grand}>
              <span>{t.netTotal}</span>
              <span className={styles.num} data-testid="purchase-total">
                {`${t.total}: ${formatMoney(total)}`}
              </span>
            </div>
          </div>
          <h2 className={styles.cardTitle}>{t.payTitle}</h2>
          <SegmentedControl
            label={t.payModeLabel}
            options={[
              { key: 'cash', label: t.allCash },
              { key: 'credit', label: t.allCredit },
              { key: 'mix', label: t.mixed },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setPaid(null);
              setOwnerPaid(null);
            }}
            testIdPrefix="pay-mode-"
          />
          <div className={styles.pay}>
            <NumberField
              key={`cash-${mode}-${mode === 'mix' ? '' : cashPaid}`}
              label={t.paidCash}
              value={cashPaid}
              onChange={(v) => {
                setMode('mix');
                setPaid(v ?? 0);
              }}
              parse={toPiasters}
              format={formatMoney}
            />
            {mayPayOwner && (
              <NumberField
                key={`owner-${mode}`}
                label={t.paidOwner}
                value={mode === 'mix' ? ownerPaid : 0}
                onChange={(v) => {
                  setMode('mix');
                  setOwnerPaid(v);
                }}
                parse={toPiasters}
                format={formatMoney}
              />
            )}
            <p data-testid="purchase-credit">{`${t.onCredit}: ${formatMoney(split?.credit ?? 0)}`}</p>
            {supplier && (
              <div className={styles.balance} data-testid="supplier-balance-after">
                {t.supplierBalanceAfter}: <b>{formatMoney(owed + (split?.credit ?? 0))}</b>
              </div>
            )}
          </div>
          {error && <BigAlert tone="danger" word={error} />}
          <ActionButton
            big
            label={t.save}
            variant="ok"
            loading={busy}
            disabled={!supplierId || !totals}
            onClick={() => void save()}
            testId="save-purchase"
          />
          <ActionButton
            label={t.discardDraft}
            variant="ghost"
            onClick={() => void discard()}
            testId="discard-draft"
          />
        </aside>
      </div>

      <QuickAddProduct
        open={quickProduct !== null}
        barcode={quickProduct ?? ''}
        onClose={() => setQuickProduct(null)}
        onAdded={(product) => {
          setQuickProduct(null);
          setScan('');
          void addProduct(product, null, true);
        }}
      />
      <QuickAddSupplier
        open={quickSupplier}
        onClose={() => setQuickSupplier(false)}
        onAdded={(id, name) => {
          setQuickSupplier(false);
          setSupplierId(id);
          setSupplierText(name);
        }}
      />
    </section>
  );
}
