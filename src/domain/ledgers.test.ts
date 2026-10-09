import { describe, expect, it } from 'vitest';

import { cashBalance, partyBalance, stockBalance } from './ledgers';

describe('ledger balances', () => {
  it('stock balance per product and warehouse', () => {
    const rows = [
      { productId: 'p1', warehouseId: 'w1', qtyMilli: 10000 },
      { productId: 'p1', warehouseId: 'w1', qtyMilli: -3000 },
      { productId: 'p1', warehouseId: 'w2', qtyMilli: 500 },
      { productId: 'p2', warehouseId: 'w1', qtyMilli: 9 },
    ];
    expect(stockBalance(rows, 'p1', 'w1')).toBe(7000);
  });
  it('party balance', () => {
    const rows = [
      { partyType: 'customer' as const, partyId: 'c1', amount: 5000 },
      { partyType: 'customer' as const, partyId: 'c1', amount: -2000 },
      { partyType: 'supplier' as const, partyId: 'c1', amount: 99 },
    ];
    expect(partyBalance(rows, 'customer', 'c1')).toBe(3000);
  });
  it('cash balance per account', () => {
    expect(
      cashBalance(
        [
          { cashAccountId: 'd', amount: 100 },
          { cashAccountId: 'd', amount: -40 },
          { cashAccountId: 's', amount: 7 },
        ],
        'd',
      ),
    ).toBe(60);
  });
});
