import { mulDivRound, type Milli, type Piasters } from './money';

/**
 * The value of a return without invoice: the supplier gives back what we paid him last time for that product
 * (`net` for `baseQtyMilli` base units on his latest invoice); with no earlier purchase from him, the product's current cost.
 */
export function defaultReturnValue(
  last: { net: Piasters; baseQtyMilli: Milli } | null,
  productCost: Piasters,
  qtyMilli: Milli,
): Piasters {
  if (last && last.baseQtyMilli > 0) return mulDivRound(last.net, qtyMilli, last.baseQtyMilli);
  return mulDivRound(productCost, qtyMilli, 1000);
}
