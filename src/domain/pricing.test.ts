import { describe, expect, it } from 'vitest';

import { EMPTY_CART, addItem, productToItem } from './cart';
import { priceFor, repriceLines } from './pricing';

const product = {
  id: 'p',
  name: 'دهان',
  price: 1000,
  priceWholesale: 800,
  priceCraftsman: null,
  priceContractor: 700,
};
const pack = { id: 'u', factor: 12000, price: 11000 };

describe('priceFor', () => {
  it('retail is the product price; a list uses its own price when set, else retail', () => {
    expect(priceFor(product, null, 'retail')).toBe(1000);
    expect(priceFor(product, null, 'wholesale')).toBe(800);
    expect(priceFor(product, null, 'craftsman')).toBe(1000);
    expect(priceFor(product, null, 'contractor')).toBe(700);
  });
  it('a pack: retail uses the pack price when it has one, a list prices the pack as price × factor', () => {
    expect(priceFor(product, pack, 'retail')).toBe(11000);
    expect(priceFor(product, pack, 'wholesale')).toBe(9600);
    expect(priceFor(product, { factor: 12000, price: null }, 'retail')).toBe(12000);
  });
});

describe('repriceLines', () => {
  it('changes only lines still at their list price; a price typed by hand stays', () => {
    let cart = addItem(EMPTY_CART, productToItem(product, null));
    cart = addItem(cart, { ...productToItem({ ...product, id: 'q' }, null), unitPrice: 900 });
    const next = repriceLines(cart, new Map(cart.lines.map((l) => [l.key, 800])));
    expect(next.lines.map((l) => l.unitPrice)).toEqual([800, 900]);
    expect(next.lines.map((l) => l.listPrice)).toEqual([800, 800]);
  });
});
