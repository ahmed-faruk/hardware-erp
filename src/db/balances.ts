import { partyBalance, stockBalance } from '@/domain/ledgers';

import type { HanafyDB } from './schema';

type Key2 = [string, string];

/** Recomputes cached stock balances from the ledger (all pairs, or only the given [productId, warehouseId] pairs). */
export async function rebuildStockBalances(db: HanafyDB, keys?: Key2[]): Promise<void> {
  const pairs =
    keys ?? uniquePairs((await db.stockMovements.toArray()).map((m): Key2 => [m.productId, m.warehouseId]));
  for (const [productId, warehouseId] of pairs) {
    const rows = await db.stockMovements
      .where('[productId+warehouseId]')
      .equals([productId, warehouseId])
      .toArray();
    const qty = stockBalance(
      rows.map((r) => ({ productId, warehouseId, qtyMilli: r.qty })),
      productId,
      warehouseId,
    );
    await db.stockBalances.put({ productId, warehouseId, qty });
  }
}

export async function rebuildPartyBalances(db: HanafyDB, keys?: Key2[]): Promise<void> {
  const pairs =
    keys ?? uniquePairs((await db.partyLedger.toArray()).map((r): Key2 => [r.partyType, r.partyId]));
  for (const [partyType, partyId] of pairs) {
    const rows = await db.partyLedger.where('[partyType+partyId]').equals([partyType, partyId]).toArray();
    if (partyType !== 'customer' && partyType !== 'supplier') continue;
    const amount = partyBalance(
      rows.map((r) => ({ partyType, partyId, amount: r.amount })),
      partyType,
      partyId,
    );
    await db.partyBalances.put({ partyType, partyId, amount });
  }
}

function uniquePairs(pairs: Key2[]): Key2[] {
  return [...new Map(pairs.map((p) => [p.join('|'), p])).values()];
}
