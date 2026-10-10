import type { Piasters } from './money';

/** What is still open on an invoice's credit part after other documents settled some of it. */
export const openAmount = (creditPart: Piasters, allocatedBefore: Piasters): Piasters =>
  Math.max(0, creditPart - allocatedBefore);

/** FIN-06: the checked invoices, in the order checked, each gets min(what is left of the amount, what is open on it). */
export function allocateInOrder(
  amount: Piasters,
  checked: string[],
  open: { invoiceId: string; open: Piasters }[],
): { invoice_id: string; amount: Piasters }[] {
  let left = amount;
  const out: { invoice_id: string; amount: Piasters }[] = [];
  for (const id of checked) {
    const inv = open.find((o) => o.invoiceId === id);
    if (!inv || left <= 0) continue;
    const take = Math.min(left, inv.open);
    if (take > 0) out.push({ invoice_id: id, amount: take });
    left -= take;
  }
  return out;
}
