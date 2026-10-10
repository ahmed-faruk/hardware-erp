import { useEffect, useState } from 'react';

import { useServices } from '@/app/session';
import { searchProducts } from '@/db/search';
import type { Product } from '@/db/types';

import { strings } from '../strings.ar';

import { FormField } from './FormField';

/** Type a name, SKU or barcode (a scanner types it and presses Enter) and pick from the matches. */
export function ProductPicker({
  onPick,
  label = strings.products.search,
}: {
  onPick: (p: Product) => void;
  label?: string;
}) {
  const { db } = useServices();
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  useEffect(() => {
    let live = true;
    void searchProducts(db, text, { limit: 8 }).then((r) => live && setFound(r));
    return () => {
      live = false;
    };
  }, [db, text]);
  const pick = (p: Product): void => {
    onPick(p);
    setText('');
  };
  return (
    <div>
      <FormField label={label}>
        {(id) => (
          <input
            id={id}
            className="control"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // ask the index again instead of trusting the list on screen, which may still be one keystroke behind
              void searchProducts(db, text, { limit: 1 }).then(([first]) => first && pick(first));
            }}
            data-testid="product-picker"
          />
        )}
      </FormField>
      {text && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {found.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="control"
                style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}
                onClick={() => pick(p)}
                data-testid={`pick-${p.sku ?? p.id}`}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
