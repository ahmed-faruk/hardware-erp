import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';

import { useServices } from '@/app/session';
import type { HanafyDB } from '@/db/schema';
import { searchProducts } from '@/db/search';
import type { Product, ProductUnit } from '@/db/types';

import { EmptyState } from '../components/EmptyState';
import { IconView } from '../icons/IconView';
import { cx } from '../cx';
import { strings } from '../strings.ar';

import { ProductTile, type TileProduct } from './ProductTile';

import { PackageOpen, Star } from 'lucide-react';
import styles from './ProductGrid.module.css';

const QUICK = 'quick';
const LIMIT = 60;

export interface GridProps {
  searchText: string;
  digits: (text: string) => string;
  onAdd: (product: Product, unit: ProductUnit | null) => void;
}

async function load(db: HanafyDB, view: string, text: string, quickIds: string[]): Promise<Product[]> {
  if (text.trim()) return searchProducts(db, text, { limit: LIMIT });
  if (view === QUICK)
    return (
      (await db.products.bulkGet(quickIds)).filter((p) => p && p.active && !p.deletedAt) as Product[]
    ).slice(0, LIMIT);
  return (await db.products.where('categoryId').equals(view).toArray())
    .filter((p) => p.active && !p.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .slice(0, LIMIT);
}

/** Category rail + product tiles. The quick grid (products pinned on this device) is the first stop; typing a search replaces the view. */
export function ProductGrid({ searchText, digits, onAdd }: GridProps) {
  const { db } = useServices();
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).sortBy('sort'), [db]);
  const quickIds = useLiveQuery(
    async () => ((await db.deviceSettings.get('quickGrid'))?.value as string[] | undefined) ?? [],
    [db],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const view = chosen ?? (quickIds && quickIds.length > 0 ? QUICK : (categories?.[0]?.id ?? QUICK));
  const products = useLiveQuery(
    () => load(db, view, searchText, quickIds ?? []),
    [db, view, searchText, quickIds],
  );
  const units = useLiveQuery(
    async () =>
      new Map((await db.productUnits.filter((u) => !u.deletedAt).toArray()).map((u) => [u.productId, u])),
    [db],
  );
  const stock = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const b of await db.stockBalances.toArray()) m.set(b.productId, (m.get(b.productId) ?? 0) + b.qty);
    return m;
  }, [db]);
  const byId = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);

  const tiles: { tile: TileProduct; product: Product; unit: ProductUnit | null }[] = (products ?? []).map(
    (p) => {
      const cat = p.categoryId ? byId.get(p.categoryId) : undefined;
      const qty = stock?.get(p.id) ?? 0;
      const unit = units?.get(p.id) ?? null;
      return {
        product: p,
        unit,
        tile: {
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          iconKey: (p.extraFields as { icon?: string } | null)?.icon ?? cat?.icon ?? null,
          color: cat?.colorToken ?? 'cat-8',
          stockState: qty <= 0 ? 'out' : p.reorderLevel > 0 && qty <= p.reorderLevel ? 'low' : 'ok',
          packName: unit?.name ?? null,
        },
      };
    },
  );

  return (
    <div className={styles.wrap}>
      <ul className={styles.rail} aria-label={strings.products.category}>
        <li>
          <button
            type="button"
            className={cx(styles.cat, view === QUICK && !searchText && styles.on)}
            onClick={() => setChosen(QUICK)}
            data-testid="cat-quick"
          >
            <Star size={24} aria-hidden="true" />
            <span>{strings.sell.quick}</span>
          </button>
        </li>
        {categories?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={cx(styles.cat, view === c.id && !searchText && styles.on)}
              style={{ ['--tint' as string]: `var(--${c.colorToken ?? 'cat-8'})` }}
              onClick={() => setChosen(c.id)}
            >
              <IconView iconKey={c.icon} size={24} aria-hidden="true" />
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {products && tiles.length === 0 ? (
        <EmptyState icon={PackageOpen} word={strings.sell.noProducts} />
      ) : (
        <div className={styles.grid}>
          {tiles.map(({ tile, product, unit }) => (
            <ProductTile
              key={tile.id}
              product={tile}
              digits={digits}
              onAdd={() => onAdd(product, null)}
              onAddPack={() => onAdd(product, unit)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
