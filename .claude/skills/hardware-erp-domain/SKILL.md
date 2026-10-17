---
name: hardware-erp-domain
description: Business rules for the hardware/paint POS - money in piasters, totals, discounts, returns, ledgers, numbering, credit, shifts, roles. Use for any code in src/domain or any calculation.
---

# Hardware ERP — domain rules (MVP)

All code here lives in `src/domain/`, is pure TypeScript (no I/O), and is unit-tested first.
Spec IDs refer to `docs/reference/prd-v2.ar.md` (grep by ID). Data model: `docs/DATABASE.md`.

## 1. Units
- `Money` = integer piasters. `Qty` = integer milli-units of the product's base unit.
- Convert only at the edges: `toPiasters("125.50") -> 12550`, `formatMoney(12550) -> "125.50"`.
- Parse user input as strings, never via `parseFloat` arithmetic.
- Rounding: half-up to the nearest piaster, at LINE level only. Never round intermediate sums twice.
- Unit conversion: a product has a base unit and optional pack unit (`factorMilli`, e.g. carton = 12 pcs → 12000).
  Line stores `unitId`, `unitFactorMilli` and `qtyMilli` in the SOLD unit; stock movement uses base units:
  `baseQtyMilli = qtyMilli * unitFactorMilli / 1000` (must be an integer; reject otherwise).

## 2. Line and invoice totals
```
gross_line   = round(qtyMilli * unitPrice / 1000)
line_disc    = percent ? round(gross_line * pct / 100) : fixed     (0 <= line_disc <= gross_line)
net_line     = gross_line - line_disc
inv_disc     = percent or fixed on sum(net_line)
alloc        = distribute inv_disc over lines proportional to net_line, largest-remainder so the sum is exact
final_line   = net_line - alloc_line
total        = sum(final_line) + tax (VAT off in MVP; keep taxAmount = 0 fields)
cash_rounding (optional, setting: 0, 25 or 50 piasters) applies ONLY to cash payment, difference stored separately
```
Store on every line: unitPrice, discount, allocatedInvoiceDiscount, netAmount, unitCost (moving average at sale time).

## 3. Payments
- Methods: `cash`, `credit` (آجل → customer ledger), `card`, `instapay`, `wallet`. Any mix in one invoice.
- `sum(payments) == total` exactly. Cash may exceed its share → `change = cashTendered - cashShare`.
- `credit` requires a customer. Card/instapay require a reference string (last 4 digits / transaction id).
- Change breakdown for the UI (`breakChange(amount, denominations)`): greedy over configurable
  denominations, default EGP notes 200,100,50,20,10,5 and coins 1, 0.50, 0.25 (in piasters).

## 4. Ledgers (balances are derived)
| Ledger | Row | Balance |
| --- | --- | --- |
| `stockMovements` | productId, warehouseId, qtyMilli (+in / −out), unitCost, docType, docId | sum per product+warehouse |
| `partyLedger` | partyType (customer/supplier), partyId, amount (+ owes us / − we owe), docType, docId | sum per party |
| `cashMovements` | cashAccountId (drawer/main safe), shiftId, amount (+in/−out), method, docId | sum per account |
Opening balances come from ONE opening document per ledger (migration).

## 5. Documents and their effects
| Document | Stock | Party | Cash |
| --- | --- | --- | --- |
| Sales invoice | −base qty per line | +credit share (customer) | +cash share (drawer) |
| Sales return (with invoice) | +qty back (damaged → scrap warehouse) | −refund to credit | −cash refund |
| Customer receipt (تحصيل) | — | −amount | +amount |
| Purchase invoice | +qty, updates moving average | −credit share (supplier) | −cash share |
| Purchase return | −qty at original cost | +amount | +cash refund |
| Supplier payment | — | +amount | −amount |
| Stock adjustment | ± qty, reason required | — | — |
| Expense | — | — | −amount, category required |
| Void (manager) | exact reverse of the original | reverse | reverse |
Legacy (migrated OSPOS) documents have `legacy: true` and produce NO movements.

## 6. Returns (RET-01..06)
- Returnable per line = sold − already returned (sum of return lines pointing to `originalLineId`).
- Refund value per unit = line `final_line / qtyMilli` (includes its share of invoice discount); cost back = original unitCost.
- Refund method: cash (≤ drawer balance), reduce customer debt, store credit, or exchange.
- Return without invoice: manager only, price entered, reason required.
- No return period (owner decision 2026-10-16): a return by invoice is allowed at any age; quantity caps only.

## 7. Costing
- Moving weighted average per product (company level): on purchase
  `newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty + inQty)` using base units; if oldQty <= 0 use inCost.
- Selling below zero stock: use last known cost; difference goes to "valuation variance" on the next purchase.

## 8. Numbering
`<devicePrefix>-<TYPE>-<seq6>` e.g. `K1-INV-000245`. Types: INV, RET, RCV (customer receipt), PUR, PRT, PAY, ADJ, EXP, VOID, SHF.
Sequence per device+type, allocated inside the same transaction as the document. Never reused, no gaps.

## 9. Credit limit (CUS-05)
`available = creditLimit − (lastSyncedBalance + unsyncedLocalCreditMovements)`.
Offline policy (setting): `allow` | `reduce:<percent>` | `block`. Over limit → manager PIN.

## 10. Shift (FIN-02..05)
Open with counted float. Close: cashier enters counted cash by denomination BEFORE seeing expected.
`variance = counted − expected`; stored automatically; manager comment required above a threshold.
One shop box, one shift (owner decision 2026-10-17): there is one open shift for the whole shop; any device sells into it and any device closes it. Expected at close = opening float + every cash movement on the box (any document, any device) between `opened_at` and the close.

## 11. Roles (MVP) and permission groups
The table below is the default of each role. A manager can build permission groups (every screen and button is an action; yes / pin / no) and give one to a worker: a worker with a group gets exactly the group, without a group he gets his role. Use `canCtx(ctx, action)` in commands and `useSession().can(action)` in screens, never `role ===`. Server: `worker_can()`.
| Action | cashier | storekeeper | manager |
| --- | --- | --- | --- |
| Sell, hold carts, return with invoice | ✓ | ✗ | ✓ |
| Discount within role limit | ✓ | ✗ | ✓ |
| Discount over limit, price override, credit over limit, no-sale drawer open | PIN | ✗ | ✓ |
| See cost / profit | ✗ | ✗ | ✓ |
| Void, return without invoice, cash adjustment | ✗ | ✗ | ✓ |
| Receive purchases, stock adjustment, edit product data (no prices) | ✗ | ✓ | ✓ |
| Customer receipt | ✓ | ✗ | ✓ |
| Record an expense from his own drawer, cash to the safe (owner decision: no limit) | ✓ | ✗ | ✓ |
| Supplier payment, prices, settings, users | ✗ | ✗ | ✓ |
`can(role, action)` lives in `src/domain/permissions.ts`; UI and server use the same table.

## 12. Invariants every test suite should assert
- Sum of payments == invoice total; sum of allocated discounts == invoice discount.
- No line returned beyond sold quantity.
- Every document with effects has matching ledger rows; deleting nothing.
- Recomputing balances from ledgers equals any cached balance.
