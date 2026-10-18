import { useLiveQuery } from 'dexie-react-hooks';
import { Package, Pencil, Plus, Tags } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveCategory } from '@/db/commands/save-master';
import type { Category } from '@/db/types';
import { formatMoney, formatQty } from '@/domain/money';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { IconPicker } from '../components/IconPicker';
import { Skeleton } from '../components/Skeleton';
import { iconFor } from '../icons/catalog';
import { IconView } from '../icons/IconView';
import { cx } from '../cx';
import { navigate } from '../router';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

const COLORS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'];

export function CategoriesScreen() {
  const { db } = useServices();
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [showing, setShowing] = useState<Category | null>(null);
  const products = useLiveQuery(async () => {
    if (!showing) return [];
    const stock = new Map<string, number>();
    for (const b of await db.stockBalances.toArray())
      stock.set(b.productId, (stock.get(b.productId) ?? 0) + b.qty);
    return (await db.products.where('categoryId').equals(showing.id).toArray())
      .filter((p) => !p.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      .map((p) => ({ ...p, qty: stock.get(p.id) ?? 0 }));
  }, [db, showing]);
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));

  const columns: Column<Category>[] = [
    {
      key: 'name',
      header: strings.categories.name,
      cell: (c) => {
        const Icon = iconFor(c.icon);
        return (
          <span className={styles.row}>
            <span
              className={styles.tile}
              style={{ background: `var(--${c.colorToken ?? 'cat-8'})`, color: '#fff' }}
            >
              <Icon size={22} aria-hidden="true" />
            </span>
            <span>{c.name}</span>
          </span>
        );
      },
    },
    {
      key: 'parent',
      header: strings.categories.parent,
      cell: (c) => (c.parentId ? (byId.get(c.parentId)?.name ?? '') : strings.categories.noParent),
    },
    {
      key: 'actions',
      header: '',
      cell: (c) => (
        <>
          <ActionButton
            label={strings.categories.edit}
            icon={Pencil}
            variant="ghost"
            onClick={() => setEditing(c)}
            testId={`edit-category-${c.id}`}
          />
          <ActionButton
            label={strings.categories.products}
            icon={Package}
            variant="soft"
            onClick={() => setShowing(c)}
            testId={`category-products-${c.id}`}
          />
        </>
      ),
    },
  ];

  return (
    <section>
      <h1 className={styles.title}>{strings.categories.title}</h1>
      <div className={styles.toolbar}>
        <div className={styles.fixed}>
          <ActionButton
            label={strings.categories.newCategory}
            icon={Plus}
            onClick={() => setEditing('new')}
            testId="new-category"
          />
        </div>
      </div>
      {!categories ? (
        <Skeleton />
      ) : categories.length === 0 ? (
        <EmptyState icon={Tags} word={strings.categories.noCategories} />
      ) : (
        <DataTable
          label={strings.categories.title}
          rows={[...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ar'))}
          columns={columns}
          rowKey={(c) => c.id}
        />
      )}
      <Dialog
        title={editing === 'new' ? strings.categories.newCategory : strings.categories.editCategory}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <CategoryForm
            category={editing === 'new' ? null : editing}
            categories={categories ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <Dialog
        title={showing ? `${strings.categories.productsOf} ${showing.name}` : ''}
        open={showing !== null}
        onClose={() => setShowing(null)}
      >
        {showing &&
          (!products ? (
            <Skeleton />
          ) : products.length === 0 ? (
            <EmptyState icon={Package} word={strings.categories.noProducts} />
          ) : (
            <DataTable
              label={strings.categories.products}
              rows={products}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate('products', p.id)}
              columns={[
                {
                  key: 'name',
                  header: strings.products.name,
                  cell: (p) => (
                    <span className={styles.row} data-testid={`category-product-${p.id}`}>
                      <span className={styles.tile}>
                        <IconView
                          iconKey={(p.extraFields as { icon?: string } | null)?.icon ?? showing.icon}
                          size={22}
                          aria-hidden="true"
                        />
                      </span>
                      <span>{p.name}</span>
                    </span>
                  ),
                },
                {
                  key: 'stock',
                  header: strings.products.stock,
                  numeric: true,
                  cell: (p) => formatQty(p.qty),
                },
                {
                  key: 'price',
                  header: strings.products.price,
                  numeric: true,
                  cell: (p) => formatMoney(p.price),
                },
              ]}
            />
          ))}
      </Dialog>
    </section>
  );
}

function CategoryForm({
  category,
  categories,
  onDone,
}: {
  category: Category | null;
  categories: Category[];
  onDone: () => void;
}) {
  const { context } = useSession();
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [color, setColor] = useState(category?.colorToken ?? 'cat-1');
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [missing, setMissing] = useState(false);
  const saver = useSaver(onDone);
  return (
    <form
      className={styles.form}
      style={{ gridTemplateColumns: '1fr' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setMissing(true);
        if (!context) return;
        void saver.run(() =>
          saveCategory(context, {
            id: category?.id,
            baseVersion: category?.version,
            fields: { name, parentId: parentId || null, colorToken: color, icon },
          }),
        );
      }}
    >
      <FormField
        label={strings.categories.name}
        error={missing && !name.trim() ? strings.common.required : null}
      >
        {(id) => (
          <input
            id={id}
            className="control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="category-name"
          />
        )}
      </FormField>
      <FormField label={strings.categories.parent}>
        {(id) => (
          <select id={id} className="control" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{strings.categories.noParent}</option>
            {categories
              .filter((c) => c.id !== category?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        )}
      </FormField>
      <div>
        <span>{strings.categories.color}</span>
        <div className={styles.swatches}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cx(styles.swatch, c === color && styles.swatchOn)}
              style={{ background: `var(--${c})` }}
              onClick={() => setColor(c)}
              aria-pressed={c === color}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div>
        <span>{strings.categories.icon}</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      {saver.error && <BigAlert tone="danger" word={saver.error} />}
      <div className={styles.actions}>
        <ActionButton
          label={strings.common.save}
          type="submit"
          variant="ok"
          loading={saver.busy}
          testId="save-category"
        />
        <ActionButton label={strings.common.cancel} variant="ghost" onClick={onDone} />
      </div>
    </form>
  );
}
