import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Tags } from 'lucide-react';
import { useState } from 'react';

import { useServices, useSession } from '@/app/session';
import { saveCategory } from '@/db/commands/save-master';
import type { Category } from '@/db/types';

import { ActionButton } from '../components/ActionButton';
import { BigAlert } from '../components/BigAlert';
import { type Column, DataTable } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField } from '../components/FormField';
import { IconPicker } from '../components/IconPicker';
import { Skeleton } from '../components/Skeleton';
import { iconFor } from '../icons/catalog';
import { cx } from '../cx';
import { strings } from '../strings.ar';

import styles from './screens.module.css';
import { useSaver } from './useSaver';

const COLORS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'];

export function CategoriesScreen() {
  const { db } = useServices();
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [db]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
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
          onRowClick={setEditing}
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
