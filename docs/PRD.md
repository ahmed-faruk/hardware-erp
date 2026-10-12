# Product Requirements Document — MVP

Read the section you need; do not load the whole file. Requirement IDs (POS-07, RET-02, …) match the full
Arabic spec in `docs/reference/prd-v2.ar.md`; grep it by ID when you need detail beyond this file.

## 1. Product overview
- **Product:** Hanafy POS (working name) for "مركز حنفي للتلوين" — a paint and hardware shop in Egypt.
- **One line:** An offline-first point of sale, stock and credit system that people who cannot read can operate.
- **Vision:** The shop never stops selling because of the internet, every piaster and every can of paint is
  accounted for, and the owner sees the truth from his phone.
- **Replaces:** OpenSourcePOS 3.3.3 (in use since June 2017) at `https://hanafy.home.kg/public/`.

## 2. Problem
- OpenSourcePOS needs the server and internet to sell; when the connection or hosting fails, the shop stops.
- Its screens are text-heavy; the counter staff cannot read, so they depend on others.
- Credit (آجل) is recorded as a payment type only: there is no customer ledger, no collection receipt,
  no supplier payments — the owner cannot see who owes what.
- The database backup button fails (HTTP 500) and there is no access to phpMyAdmin: the shop's data is at risk.

## 3. Goal (MVP)
Replace OpenSourcePOS in daily use with: all existing data migrated, selling/printing/receiving that work with
the router unplugged, a cashier screen usable without reading, customer and supplier balances that are always right.

## 4. Real data volumes (from the live OSPOS, 9 Oct 2026)
| Data | Volume |
| --- | --- |
| Products | 1,406 active, 1 stock location ("stock") |
| Customers / suppliers / employees | 36 / 37 / 3 |
| Sales since 29 Jun 2017 | ~68,500 (≈1,600 per month now, ≈55 per day) |
| Expenses | ~6,000 |
| Currency / locale | EGP, Western digits, dates d/m/Y, Africa/Cairo, VAT not applied |
| Exported 9 Oct 2026 | 63,049 sales + 5,455 returns (324,602 lines), 5,343 receivings (23,740 lines), 6,026 expenses |
| Credit (آجل) in OSPOS | none recorded — payments are cash (3 debit card); current customer/supplier balances exist only on paper |
| Product photos / barcodes | 0 products have a photo; 130 have no barcode |

## 5. Target users
| Persona | Reads? | Device | Needs |
| --- | --- | --- | --- |
| Owner / manager | Yes | PC + phone | Prices, approvals by PIN, balances, profit, reports, settings |
| Cashier | Often **no** | Windows 7 PC at the counter | Sell fast by photo/barcode, take money, print, give correct change |
| Storekeeper | Partly | PC or phone | Receive goods, count stock, adjust with reason |

## 6. Core features (MVP)
| Area | Features | IDs |
| --- | --- | --- |
| Foundation | Installable PWA, works offline, local DB, sync to cloud, device registration, worker login by photo + PIN, local encrypted backup, audit log | ARC-01..06, SYN-01..05, BAK-01..05, SEC-01..05, AUD-01..03 |
| Catalog | Products with photo, category, barcode, cost, price, reorder level; base unit + one pack unit; fractional quantities | INV-01..03 |
| Selling | Barcode/photo/search, quick grid, hold multiple carts, cash/credit/card/InstaPay/split, print 58/80 mm, reprint marked "copy", no-sale drawer open with reason | POS-01..13, PAY-01..03 |
| Returns & voids | Return by invoice (never above sold qty), manager-only return without invoice, manager void by reversing document | RET-01..08, VOID-01..02 |
| Customers | Ledger balance, credit limit (offline policy), collection receipt, statement | CUS-01, CUS-03, CUS-05 |
| Purchasing | Suppliers, receive goods (updates moving-average cost), supplier payment, statement, purchase return | PUR-01, PUR-02, PUR-05..08 |
| Stock | Movement ledger, balances per warehouse, stock adjustment with reason, low-stock list | INV-06, INV-07, INV-10, INV-11, INV-13, INV-14 |
| Cash | Shift open with float, blind close, variance recorded, expenses, transfer to main safe | FIN-01..07, FIN-11 |
| Reports | Daily sales, profit (manager), stock on hand + low stock, customer/supplier statements, shift X/Z, exceptions, device sync status | §15 |
| Migration | Full OSPOS export → validated import, archive of history, approved opening balances | §20, `docs/DATABASE.md` §9 |

> **Added by the owner on 2026-10-11 (outside the original MVP list, approved by him):** available quantity on sale tiles; permission groups for every screen and button; purchases paid from the safe and/or the owner's pocket; item movement history (imported history included); expenses report; category KPIs and charts; payroll (salary, advances, deductions) with reports; smart overview report.

## 7. User flows (each is an e2e test)
1. **Cash sale:** scan or tap photos → adjust qty → pay (cash) → change shown as notes → receipt prints only when the cashier presses «اطبع تاني» (nothing prints by itself) → drawer opens with that print.
2. **Credit sale + collection:** pick customer by photo/phone → credit or split → receipt shows old/new balance →
   later "receive payment" reduces the ledger.
3. **Return with invoice:** scan receipt number/QR → choose lines and qty (≤ sold − returned) → refund method → stock back.
4. **Purchase:** pick supplier → scan items, cost, qty → cash or credit → stock and average cost updated → pay supplier later.
5. **Shift:** open with counted float → sell all day → close: count notes by denomination before seeing expected → Z report.
6. **Stock adjustment:** storekeeper counts → enters difference with reason → manager approves above threshold.
7. **Offline day:** router unplugged all day on two devices → everything works → reconnect → sync with zero loss, identical balances.
8. **Manager approval:** cashier hits a limit (discount, price, credit) → manager enters PIN on the same device → logged.
9. **Migration day:** final OSPOS export → import → validation report signed → sell in the new system next morning.

## 8. Requirements
### Functional rules that must never break
- Money is integer piasters; quantities integer milli-units; rounding half-up per line.
- Posted documents are immutable; balances are derived from ledgers.
- Returnable qty per line = sold − already returned.
- Sum of payments = invoice total exactly.

### UX
- Cashier screens follow `docs/DESIGN_SYSTEM.md` §1–§9 (photo-first, icon + color + fixed position, sounds, spoken totals,
  change shown as notes, PIN instead of text confirmations, undo instead of "are you sure").
- Every cashier action reachable by keyboard, by touch, and by barcode scanner.
- Arabic RTL everywhere; digits style (123 or ١٢٣) is a setting.

### Performance (on Core i3 / 4 GB / Windows 7 / Firefox ESR 115)
- Product search in 20,000 items ≤ 300 ms; save sale → print starts ≤ 1 s; cold start offline ≤ 5 s.
- 5-item barcode sale by a trained cashier ≤ 30 s.

### Platform
- Firefox ESR 115 on Windows 7 (transitional), current Chrome/Edge/Firefox, Android Chrome, iOS Safari 16.4+ as installed PWA.
- Screens from 320 px to 2560 px wide (`docs/DESIGN_SYSTEM.md` §8).
- Hosting: Cloudflare Pages + Supabase free tiers (`docs/ARCHITECTURE.md`).

## 9. Success metrics
| Metric | Target |
| --- | --- |
| Days the shop could not sell because of the system | 0 |
| Lost or duplicated transactions after sync | 0 |
| Cashier completes a sale without help after 15 min training | Yes, for every cashier |
| Shift variance explained | 100% of shifts closed blind with variance recorded |
| Owner can see any customer's balance | From the phone, any time, updated at last sync |
| Migration validation report | All blocking checks pass before go-live |

## 10. Out of scope for the MVP (deferred)
Paint mixing (MIX-*), craftsman commissions (CRF-*), customer projects, quotations, mobile sales orders/QR,
cheques and banks, multi-warehouse transfers, batches/expiry, consignment, general ledger and financial statements,
VAT returns, ETA e-receipt and e-invoice (unless the shop turns out to be obligated — open question 1),
label printing, scale integration, multiple branches. Ask before building any of these.

## 11. Open questions (owner decides)
1. Is the shop registered for VAT / obligated to issue ETA e-receipts? (check by tax registration number)
2. Upgrade path for the Windows 7 PCs before Firefox ESR 115 support ends (announced: March 2027).
3. Offline credit-limit policy: allow / reduce by % / block.
4. Return period in days and who approves after it.
5. Cash rounding: none / 0.25 / 0.50 EGP.
6. Opening balances for each customer and supplier: OSPOS has none, the owner enters them in the import sheet.
7. Which products to photograph first (none have photos); suggestion: the 100 best sellers from the export.
