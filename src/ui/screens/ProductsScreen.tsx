import { useLiveQuery } from 'dexie-react-hooks';
import { Package, Plus } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import type { HanafyDB } from '@/db/schema';
import { searchProducts } from '@/db/search';
import type { Product } from '@/db/types';
import { formatMoney, formatQty } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { type Column, DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { Skeleton } from '../components/Skeleton';
import { IconView } from '../icons/IconView';
import { navigate } from '../router';
import { strings } from '../strings.ar';

import styles from './screens.module.css';

const PAGE = 50;

type Row = Product & { qty: number; low: boolean };

async function loadRows(db: HanafyDB, text: string, category: string, low: boolean): Promise<Row[]> {
  const balances = await db.stockBalances.toArray();
  const stock = new Map<string, number>();
  for (const b of balances) stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
  let list: Product[];
  if (text.trim()) list = await searchProducts(db, text, { includeInactive: true, limit: 500 });
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
  const { worker } = useSession();
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [low, setLow] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const rows = useLiveQuery(() => loadRows(db, text, category, low), [db, text, category, low]);
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
        <div className={styles.fixed}>
          <ActionButton
            label={strings.products.newProduct}
            icon={Plus}
            onClick={() => navigate('products', 'new')}
            testId="new-product"
          />
        </div>
      </div>
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Package} word={strings.products.noProducts} />
      ) : (
        <>
          <DataTable
            label={strings.products.title}
            rows={rows.slice(0, shown)}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate('products', r.id)}
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
