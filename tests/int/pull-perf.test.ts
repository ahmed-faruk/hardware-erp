import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { searchProducts } from '@/db/search';
import { HanafyDB } from '@/db/schema';
import { applyPage } from '@/sync/pull';

/** The first sync of a big catalog: every product shares two words, the worst case for the search index. */
describe('first pull of 20,000 products', () => {
  it('applies in pages quickly and the index finds the products afterwards', async () => {
    const db = new HanafyDB(`pull-perf-${Math.random()}`);
    const started = Date.now();
    for (let page = 0; page < 20; page++) {
      const rows = Array.from({ length: 1000 }, (_, i) => {
        const g = page * 1000 + i + 1;
        return {
          table: 'products',
          record: {
            id: `00000000-0000-7000-8000-${String(g).padStart(12, '0')}`,
            company_id: 'c',
            sku: `PERF${g}`,
            name: `بيرف ${g} صنف ${g % 97}`,
            base_unit_name: 'pcs',
            type: 'stock',
            active: true,
            price: 1000,
            unit_cost: 500,
            version: 1,
            qty_decimals: 0,
            created_at: '2026-10-10T00:00:00Z',
            updated_at: '2026-10-10T00:00:00Z',
          },
        };
      });
      await applyPage(db, { rows, last_seq: (page + 1) * 1000, has_more: page < 19 });
    }
    const elapsed = Date.now() - started;
    console.log(`20,000 products applied in ${elapsed} ms`);
    expect(await db.products.count()).toBe(20000);
    expect((await searchProducts(db, 'بيرف 12345', { limit: 5 })).map((p) => p.sku)).toContain('PERF12345');
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);
});
