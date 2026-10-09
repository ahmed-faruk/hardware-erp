# Browser export format (`ospos-browser-export/1`) and mapping

Produced by `tools/ospos-export/export.js` from OSPOS 3.3.3 pages. All values are display strings as OSPOS shows them
(shop config: currency "EGP", number locale en_EG → Western digits, `1,234.50`; date format d/m/Y; Africa/Cairo).

## 1. Top level
| Key | Content |
| --- | --- |
| `meta` | `source`, `base`, `exportedAt`, `finishedAt`, `title`, `format`, `salesSearchTotal` (all sales incl. canceled/suspended), `saleLineColumns`, `receivingLineColumns`, `counts`, `errors` |
| `items[]` | from Items list: `items.item_id`, `item_number` (barcode), `name`, `category`, `company_name` (supplier), `cost_price`, `unit_price`, `quantity` (location 1), `tax_percents`, `item_pic_url`, plus attribute columns keyed by definition id |
| `inventory_summary[]` | Inventory summary report: `item_name`, `item_number`, `category`, `quantity`, `low_sell_quantity`, `reorder_level`, `location_name`, `cost_price`, `unit_price`, `subtotal` |
| `customers[]` | `person_id`, `list` {first_name, last_name, email, phone_number, total_spent}, `form` = every field of the edit form (names as OSPOS uses: first_name, last_name, gender, email, phone_number, address_1, address_2, city, state, zip, country, comments, company_name, account_number, discount, discount_type, taxable, …) |
| `suppliers[]` | `person_id`, `list` {company_name, agency_name, category, first_name, last_name, email, phone_number}, `form` (edit form fields) |
| `employees[]` | `person_id`, `first_name`, `last_name` |
| `expenses[]` | Expenses list rows (id, date, supplier, category, amount, tax, payment type, description, employee) — inspect keys first |
| `sales[]` | Detailed sales report summary rows, one per completed sale/return: `id`, `type_code`, `sale_date`, `quantity`, `employee_name`, `customer_name`, `subtotal`, `tax`, `total`, `cost`, `profit`, `payment_type`, `comment` |
| `sale_lines{}` | `{ saleId: [ [name, category, item_number, description, quantity, subtotal, tax, total, cost, profit, discount], … ] }` |
| `receivings[]` | Detailed receivings summary: `id`, `receiving_date`, `quantity`, `employee_name`, `supplier_name`, `total`, `profit`, `payment_type`, `reference`, `comment` |
| `receiving_lines{}` | `{ receivingId: [ [item_number, name, category, quantity, total, discount], … ] }` |
Column order of the line arrays is confirmed by `meta.saleLineColumns` / `meta.receivingLineColumns` — assert it before parsing.

## 2. Parsing helpers
| Value | Rule |
| --- | --- |
| Money `"EGP 1,234.50"`, `"-EGP 5.00"`, `"EGP -5.00"` | keep sign, drop everything but digits and `.`, × 100 half-up → bigint |
| Quantity `"76.00"`, `"1.00 [stock]"`, `"2.00 x 12.00"` | strip `[location]`; `a x b` = a packs × b units; × 1000 |
| Discount `"10.00%"` / `"EGP 5.00"` | percent → basis points; money → piasters (whole-line amount) |
| Date `"01/09/2026"` | d/m/Y → `2026-09-01`, time unknown → `12:00` Africa/Cairo |
| Text | already HTML-stripped; trim, collapse spaces, normalise Arabic (أ إ آ→ا, ى→ي, ة→ه) for matching only |

## 3. Mapping
| Export | New table | Notes |
| --- | --- | --- |
| `items` + `inventory_summary` (join on item_number, then name) | `products`, `categories`, `barcodes`, `stock_movements` (opening) | price/cost from items; reorder level from inventory_summary; category text → categories (trim) |
| `items.company_name` | `products.default_supplier_id` | match supplier company name |
| `customers` | `customers` | name = trim(first + " " + last); phone digits only; address = address_1 + address_2 + city; notes = comments |
| `suppliers` | `suppliers` | name = company_name (fallback person name); contact = person name; `category` 1 → `is_expense_supplier` |
| `employees` | `workers` (inactive, role cashier, no PIN) | for history display only |
| `sales` + `sale_lines` | `sales_invoices`/`sales_returns` + lines + `payments` (`is_legacy`) | line unit price = subtotal ÷ qty; keep cost & discount; customer by full name |
| `receivings` + `receiving_lines` | `purchase_invoices`/`purchase_returns` + lines (`is_legacy`) | supplier by name; payment label → method |
| `expenses` | `expenses` (`is_legacy`) + `expense_categories` | |

## 4. Payment strings
Sales: `"نقدى 590.00, مستحق 100.00"` → split on `", "`; last token = amount; the rest = label.
Receivings: label only (`"نقدى"`), amount = receiving total.

## 5. Payment label map
| Label (ar-EG UI) | Also seen (en) | Method |
| --- | --- | --- |
| نقدى / نقدي | Cash | `cash` |
| مستحق | Due | `credit` |
| بطاقة إئتمانية / بطاقة خصم | Credit Card / Debit Card | `card` |
| شيك | Check | `other` (cheques deferred; report) |
| بطاقة هدية… | Gift Card | `other` (report) |
| anything else | | `other` (report) |
Build the list of distinct labels first and show it to the owner before transforming.
First export (9 Oct 2026): sales labels = نقدى (68,479 sales), بطاقة خصم (3); receivings = نقدى (5,333), Cash (1), empty (9 → cash).
No credit sales exist in OSPOS, so every opening balance comes from the owner's sheet.

## 6. Suggested opening balances (owner approves in xlsx)
- Customer: Σ `credit` amounts on their sales − Σ `credit` refunds on their returns. OSPOS has no collection receipt,
  so money already collected is NOT deducted → the owner must correct every non-zero balance.
- Supplier: Σ receivings paid by `مستحق` − returns. Same caveat.
- Rows with zero suggestion are still listed so the owner can enter balances OSPOS never knew.
