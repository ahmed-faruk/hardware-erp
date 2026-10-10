import { err, ok, type Result } from './result';
import { mulDivRound, type Milli, type Piasters } from './money';
import { computeInvoice, type Discount, type InvoiceResult } from './totals';

export interface CartItem {
  productId: string;
  /** null = the base unit; otherwise the pack unit id */
  productUnitId: string | null;
  unitFactorMilli: Milli;
  name: string;
  qtyMilli: Milli;
  unitPrice: Piasters;
  /** the product's list price when it was added, so approval rules can tell a changed price */
  listPrice: Piasters;
}

export interface CartLine extends CartItem {
  key: string;
  discount?: Discount;
}

export interface Cart {
  lines: CartLine[];
  invoiceDiscount: Discount | null;
  customerId: string | null;
}

export const EMPTY_CART: Cart = { lines: [], invoiceDiscount: null, customerId: null };

export const lineKey = (productId: string, productUnitId: string | null): string =>
  `${productId}:${productUnitId ?? ''}`;

const mapLine = (cart: Cart, key: string, change: (l: CartLine) => CartLine): Cart => ({
  ...cart,
  lines: cart.lines.map((l) => (l.key === key ? change(l) : l)),
});

/** Adding the same product in the same unit adds to its quantity (the second scan makes 2). */
export function addItem(cart: Cart, item: CartItem): Cart {
  const key = lineKey(item.productId, item.productUnitId);
  if (cart.lines.some((l) => l.key === key))
    return mapLine(cart, key, (l) => ({ ...l, qtyMilli: l.qtyMilli + item.qtyMilli }));
  return { ...cart, lines: [...cart.lines, { ...item, key }] };
}

export const removeLine = (cart: Cart, key: string): Cart => ({
  ...cart,
  lines: cart.lines.filter((l) => l.key !== key),
});

/** Zero or less removes the line. */
export function setQty(cart: Cart, key: string, qtyMilli: Milli): Cart {
  return qtyMilli <= 0 ? removeLine(cart, key) : mapLine(cart, key, (l) => ({ ...l, qtyMilli }));
}

export const setLinePrice = (cart: Cart, key: string, unitPrice: Piasters): Cart =>
  mapLine(cart, key, (l) => ({ ...l, unitPrice }));
export const setCustomer = (cart: Cart, customerId: string | null): Cart => ({ ...cart, customerId });

/** Totals always come from `computeInvoice`; a discount larger than the amount is an error, never silently clamped. */
export function cartInvoice(cart: Cart): Result<InvoiceResult> {
  try {
    return ok(
      computeInvoice(
        cart.lines.map((l) => ({ qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, discount: l.discount })),
        cart.invoiceDiscount,
      ),
    );
  } catch (e) {
    return err('INVALID_DISCOUNT', e instanceof Error ? e.message : 'invalid discount');
  }
}

function validated(cart: Cart): Result<Cart> {
  const inv = cartInvoice(cart);
  return inv.ok ? ok(cart) : inv;
}

export const setLineDiscount = (cart: Cart, key: string, discount: Discount | undefined): Result<Cart> =>
  validated(mapLine(cart, key, (l) => ({ ...l, discount })));

export const setInvoiceDiscount = (cart: Cart, discount: Discount | null): Result<Cart> =>
  validated({ ...cart, invoiceDiscount: discount });

/** The line shape `postSale` takes. */
export function toSaleLines(cart: Cart) {
  return cart.lines.map((l) => ({
    productId: l.productId,
    productUnitId: l.productUnitId,
    unitFactorMilli: l.unitFactorMilli,
    qtyMilli: l.qtyMilli,
    unitPrice: l.unitPrice,
    discount: l.discount,
  }));
}

/** A tapped or scanned product becomes a cart item; a pack unit uses its own price, or the base price times its factor. */
export function productToItem(
  product: { id: string; name: string; price: Piasters },
  unit?: { id: string; factor: Milli; price: Piasters | null } | null,
  qtyMilli: Milli = 1000,
): CartItem {
  const price = unit ? (unit.price ?? mulDivRound(product.price, unit.factor, 1000)) : product.price;
  return {
    productId: product.id,
    productUnitId: unit?.id ?? null,
    unitFactorMilli: unit?.factor ?? 1000,
    name: product.name,
    qtyMilli,
    unitPrice: price,
    listPrice: price,
  };
}
