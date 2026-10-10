import { describe, expect, it } from 'vitest';

import {
  addItem,
  cartInvoice,
  EMPTY_CART,
  removeLine,
  setInvoiceDiscount,
  setLineDiscount,
  setLinePrice,
  setQty,
  toSaleLines,
  type CartItem,
} from './cart';

const paint: CartItem = {
  productId: 'p1',
  productUnitId: null,
  unitFactorMilli: 1000,
  name: 'دهان',
  qtyMilli: 1000,
  unitPrice: 12500,
  listPrice: 12500,
};
const carton: CartItem = {
  ...paint,
  productUnitId: 'u1',
  unitFactorMilli: 12000,
  unitPrice: 140000,
  listPrice: 140000,
};
const wire: CartItem = {
  productId: 'p2',
  productUnitId: null,
  unitFactorMilli: 1000,
  name: 'سلك',
  qtyMilli: 2500,
  unitPrice: 800,
  listPrice: 800,
};

describe('cart', () => {
  it('adding the same product and unit again adds to the quantity', () => {
    const c = addItem(addItem(EMPTY_CART, paint), paint);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]?.qtyMilli).toBe(2000);
  });
  it('a pack unit is a different line from the base unit', () => {
    expect(addItem(addItem(EMPTY_CART, paint), carton).lines).toHaveLength(2);
  });
  it('totals come from the domain (fractions round half-up per line)', () => {
    const c = addItem(addItem(EMPTY_CART, paint), wire);
    const inv = cartInvoice(c);
    expect(inv.ok && inv.value.total).toBe(12500 + 2000);
  });
  it('set quantity; zero or less removes the line', () => {
    const c = addItem(EMPTY_CART, paint);
    expect(setQty(c, 'p1:', 3000).lines[0]?.qtyMilli).toBe(3000);
    expect(setQty(c, 'p1:', 0).lines).toHaveLength(0);
    expect(removeLine(c, 'p1:').lines).toHaveLength(0);
  });
  it('line discount: percent and fixed; above the line amount is rejected and the cart is unchanged', () => {
    const c = addItem(EMPTY_CART, paint);
    const pct = setLineDiscount(c, 'p1:', { kind: 'percentBp', valueBp: 1000 });
    expect(pct.ok && cartInvoice(pct.value)).toMatchObject({ ok: true, value: { total: 11250 } });
    const bad = setLineDiscount(c, 'p1:', { kind: 'fixed', value: 12501 });
    expect(bad).toMatchObject({ ok: false });
  });
  it('invoice discount over the total is rejected', () => {
    const c = addItem(EMPTY_CART, paint);
    expect(setInvoiceDiscount(c, { kind: 'fixed', value: 99999 })).toMatchObject({ ok: false });
    const ok = setInvoiceDiscount(c, { kind: 'fixed', value: 500 });
    expect(ok.ok && cartInvoice(ok.value)).toMatchObject({ ok: true, value: { total: 12000 } });
  });
  it('a changed price keeps the list price so approval rules can compare', () => {
    const c = setLinePrice(addItem(EMPTY_CART, paint), 'p1:', 10000);
    expect(c.lines[0]).toMatchObject({ unitPrice: 10000, listPrice: 12500 });
  });
  it('maps to the postSale line shape', () => {
    const c = addItem(addItem(EMPTY_CART, carton), wire);
    expect(toSaleLines(c)).toEqual([
      {
        productId: 'p1',
        productUnitId: 'u1',
        unitFactorMilli: 12000,
        qtyMilli: 1000,
        unitPrice: 140000,
        discount: undefined,
      },
      {
        productId: 'p2',
        productUnitId: null,
        unitFactorMilli: 1000,
        qtyMilli: 2500,
        unitPrice: 800,
        discount: undefined,
      },
    ]);
  });
  it('an empty cart has a zero total', () => {
    const inv = cartInvoice(EMPTY_CART);
    expect(inv.ok && inv.value.total).toBe(0);
  });
});
