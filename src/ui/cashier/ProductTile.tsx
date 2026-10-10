import { IconView } from '../icons/IconView';
import { formatMoney } from '@/domain/money';

import { cx } from '../cx';

import styles from './ProductTile.module.css';

export interface TileProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  iconKey: string | null;
  /** category color token: cat-1 .. cat-8 */
  color: string;
  stockState: 'ok' | 'low' | 'out';
  /** name of the pack unit when the product has one (carton, roll...) */
  packName: string | null;
}

/** No photo yet (UX-02): the category icon on its color, the product code in big digits, the price, a stock dot. Tap adds one. */
export function ProductTile({
  product,
  digits,
  onAdd,
  onAddPack,
}: {
  product: TileProduct;
  digits: (text: string) => string;
  onAdd: () => void;
  onAddPack: () => void;
}) {
  return (
    <div
      className={styles.tile}
      style={{ ['--tint' as string]: `var(--${product.color})` }}
      data-testid={`tile-${product.id}`}
    >
      <button type="button" className={styles.main} onClick={onAdd} aria-label={product.name}>
        <span className={styles.art}>
          <IconView iconKey={product.iconKey} size={36} aria-hidden="true" />
          {product.sku && <span className={styles.code}>{digits(product.sku.slice(-6))}</span>}
        </span>
        <span className={styles.name}>{product.name}</span>
        <span className={styles.price}>{digits(formatMoney(product.price))}</span>
        <span className={cx(styles.dot, styles[product.stockState])} aria-hidden="true" />
      </button>
      {product.packName && (
        <button type="button" className={styles.pack} onClick={onAddPack} aria-label={product.packName}>
          {`+ ${product.packName}`}
        </button>
      )}
    </div>
  );
}
