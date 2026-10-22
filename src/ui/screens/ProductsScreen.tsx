import { useLiveQuery } from 'dexie-react-hooks';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { restoreProduct } from '@/db/commands/archive-product';
import type { HanafyDB } from '@/db/schema';
import { searchProducts } from '@/db/search';
import type { Product } from '@/db/types';
import { formatMoney, formatQty } from '@/domain/money';

import { BigAlert } from '../components/BigAlert';
import { ActionButton } from '../components/ActionButton';
import { type Column, DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { Skeleton } from '../components/Skeleton';
import { IconView } from '../icons/IconView';
import { navigate } from '../router';
import { strings } from '../strings.ar';

import { useProductDelete } from './useProductDelete';
import styles from './screens.module.css';

const PAGE = 50;

/** The filters of this screen, kept while the app is open: coming back from a product's form shows the same list (owner decision 2026-10-22). */
const kept = { text: '', category: '', low: false, archived: false };

type Row = Product & { qty: number; low: boolean };

async function loadRows(
  db: HanafyDB,
  text: string,
  category: string,
  low: boolean,
  archived: boolean,
): Promise<Row[]> {
  const balances = await db.stockBalances.toArray();
  const stock = new Map<string, number>();
  for (const b of balances) stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
  let list: Product[];
  if (archived) {
    // archived products: only the deleted ones, found by name
    const needle = text.trim().toLowerCase();
    list = (await db.products.filter((p) => !!p.deletedAt).toArray())
      .filter(
        (p) =>
          !needle || p.name.toLowerCase().includes(needle) || (p.sku ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  } else if (text.trim()) list = await searchProducts(db, text, { includeInactive: true, limit: 500 });
  else if (category)
    list = (await db.products.where('categoryId').equals(category).toArray()).filter((p) => !p.deletedAt);
  else
    list = await db.products
      .orderBy('name')
      .filter((p) => !p.deletedAt)
      .toArray();
  const rows = list
    .filter((p) => !category || p.categoryId === category)
    .map((p): Row => {
      const qty = stock.get(p.id) ?? 0;
      return { ...p, qty, low: p.reorderLevel > 0 && qty <= p.reorderLevel };
    });
  return low ? rows.filter((r) => r.low) : rows;
}

export function ProductsScreen() {
  const { db } = useServices();
  const { worker, context, can } = useSession();
  const [text, setText] = useState(kept.text);
  const [category, setCategory] = useState(kept.category);
  const [low, setLow] = useState(kept.low);
  const [archived, setArchived] = useState(kept.archived);
  useEffect(() => {
    kept.text = text;
    kept.category = category;
    kept.low = low;
    kept.archived = archived;
  }, [text, category, low, archived]);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  // the delete button of a row: the same flow as inside the product (server check, undo toast; archive when it has history)
  const remove = useProductDelete();
  const [shown, setShown] = useState(PAGE);
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const rows = useLiveQuery(
    () => loadRows(db, text, category, low, archived),
    [db, text, category, low, archived],
  );
  const isManager = worker?.role === 'manager';

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: strings.products.name,
      cell: (r) => (
        <span className={styles.row}>
          <span className={styles.tile}>
            <IconView
              iconKey={
                (r.extraFields as { icon?: string } | null)?.icon ??
                categories?.find((c) => c.id === r.categoryId)?.icon
              }
              size={22}
              aria-hidden="true"
            />
          </span>
          <span>{r.name}</span>
          {r.deletedAt && (
            <span className={styles.low} data-testid={`archived-mark-${r.id}`}>
              {strings.products.archivedMark}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'stock',
      header: strings.products.stock,
      numeric: true,
      cell: (r) => <span className={r.low ? styles.low : undefined}>{formatQty(r.qty)}</span>,
    },
    { key: 'price', header: strings.products.price, numeric: true, cell: (r) => formatMoney(r.price) },
    ...(isManager
      ? [
          {
            key: 'cost',
            header: strings.products.cost,
            numeric: true,
            wideOnly: true,
            cell: (r: Row) => formatMoney(r.unitCost),
          },
        ]
      : []),
  ];

  const restore = (id: string): void => {
    if (!context) return;
    setRestoreNote(null);
    void restoreProduct(context, id).then((r) => {
      if (!r.ok)
        return setRestoreNote(
          r.code === 'SKU_TAKEN' ? strings.products.restoreSkuTaken : strings.errors.saveFailed,
        );
      setRestoreNote(
        r.skippedBarcodes.length
          ? `${strings.products.restoredSkipped}: ${r.skippedBarcodes.join(strings.cash.listSeparator)}`
          : strings.products.restored,
      );
    });
  };
  const mayRemove = can('editProductData') === 'yes' || can('archiveProduct') === 'yes';
  const withDelete: Column<Row>[] =
    mayRemove && !archived
      ? [
          ...columns,
          {
            key: 'remove',
            header: '',
            cell: (r: Row) => (
              // the row opens the product: the button must not
              <span
                role="presentation"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <ActionButton
                  label={strings.products.deleteProduct}
                  icon={Trash2}
                  variant="ghost"
                  disabled={remove.busy}
                  onClick={() => void remove.start(r.id, r.name)}
                  testId={`row-delete-${r.id}`}
                />
              </span>
            ),
          },
        ]
      : columns;
  const columnsAll: Column<Row>[] = archived
    ? [
        ...withDelete,
        {
          key: 'restore',
          header: '',
          cell: (r: Row) => (
            <ActionButton
              label={strings.products.restore}
              variant="soft"
              onClick={() => restore(r.id)}
              testId={`restore-${r.id}`}
            />
          ),
        },
      ]
    : withDelete;

  return (
    <section>
      <h1 className={styles.title}>{strings.products.title}</h1>
      <div className={styles.toolbar}>
        <FormField label={strings.common.search}>
          {(id) => (
            <input
              id={id}
              className="control"
              type="search"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setShown(PAGE);
              }}
              placeholder={strings.products.search}
              data-testid="product-search"
            />
          )}
        </FormField>
        <FormField label={strings.products.category}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="product-category-filter"
            >
              <option value="">{strings.products.allCategories}</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <label className={styles.check}>
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />
          {strings.products.lowStock}
        </label>
        {can('archiveProduct') === 'yes' && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                setShown(PAGE);
              }}
              data-testid="archived-filter"
            />
            {strings.products.archived}
          </label>
        )}
        <div className={styles.fixed}>
          <ActionButton
            label={strings.products.newProduct}
            icon={Plus}
            onClick={() => navigate('products', 'new')}
            testId="new-product"
          />
        </div>
      </div>
      {remove.view}
      {restoreNote && <BigAlert tone="ok" word={restoreNote} sound={false} />}
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Package} word={strings.products.noProducts} />
      ) : (
        <>
          <DataTable
            label={strings.products.title}
            rows={rows.slice(0, shown)}
            columns={columnsAll}
            rowKey={(r) => r.id}
            onRowClick={(r) => (r.deletedAt ? undefined : navigate('products', r.id))}
          />
          {rows.length > shown && (
            <p>
              <ActionButton
                label={strings.actions.showMore}
                variant="ghost"
                onClick={() => setShown(shown + PAGE)}
              />
            </p>
          )}
        </>
      )}
    </section>
  );
}
