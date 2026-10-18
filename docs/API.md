# API

There is no custom backend server. The app talks to two APIs:

1. **Internal command API** (in the browser): `src/db/commands/*` — every screen writes data only through these.
2. **Supabase API** (cloud): Auth for devices, Postgres RPC functions for sync, Storage for product images.
   Selling never waits for either cloud call.

## 1. Base configuration

| Env                                                                                                                | Supabase URL                                     | Notes                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------- |
| Development                                                                                                        | `http://127.0.0.1:54321` (from `supabase start`) |                         |
| Preview                                                                                                            | `VITE_SUPABASE_URL` of the staging project       | set per GitHub variable |
| Production                                                                                                         | `VITE_SUPABASE_URL` of the production project    |                         |
| Client: `@supabase/supabase-js` created once in `src/sync/supabase.ts`. Format: JSON. Times: ISO 8601 with offset. |
| RPC versioning: the client sends `app_version`; the server accepts the current and two previous minor versions.    |

## 2. Authentication

- Each shop device has one Supabase Auth user (email + password) created by the manager on first setup.
  The device signs in once online; supabase-js refreshes the JWT; offline the app keeps working with the cached session.
- Workers are NOT Supabase users. They log in with a username and password (checked by the server, or by the device's own verifier offline); every row they create carries `created_by`.
- Every RPC begins with `assert_device_active()` → raises `E_DEVICE_REVOKED` for revoked devices.
- `service_role` is used only by `tools/ospos-import` on the Mac (env file, never committed, never in the bundle).

## 3. Response envelope (all RPCs)

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "E_VALIDATION", "message": "Arabic text safe to show", "details": { } } }
```

| Code                                                                                 | Meaning                                                                   | Client reaction                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `E_VALIDATION`                                                                       | payload shape or business rule failed                                     | mark row rejected, show on manager sync screen         |
| `E_FORBIDDEN`                                                                        | worker role or device role not allowed                                    | mark rejected, audit                                   |
| `E_IN_USE`                                                                           | a product delete was refused: the product has movements, history or stock | mark rejected, show on manager sync screen             |
| `E_DEVICE_REVOKED`                                                                   | device revoked by manager                                                 | stop sync, wipe local data at next start               |
| `E_VERSION_TOO_OLD`                                                                  | app older than accepted versions                                          | show "update needed", keep selling, retry after update |
| `E_CONFLICT`                                                                         | master-data field conflict                                                | server value kept, conflict logged                     |
| `E_RATE_LIMIT`                                                                       | too many calls                                                            | back off                                               |
| `E_INTERNAL`                                                                         | unexpected                                                                | retry with backoff, log `client_errors`                |
| Network errors are not envelopes: retry 5 s, 30 s, 2 min, 10 min, then every 10 min. |

## 4. RPC endpoints (`supabase.rpc(name, args)`)

### `ping()`

Returns `{ ok, data: { server_time } }`. Every 30 s for connectivity and clock skew.

### `ingest_batch(device_id uuid, app_version text, rows jsonb)`

Push outbox rows in order. Limits: ≤ 200 rows, ≤ 1 MB, one batch in flight per device.
Request row:

```json
{
  "seq": 1042,
  "device_seq": 1042,
  "table": "sales_invoices",
  "op": "upsert",
  "record": { "id": "0190f…", "number": "K1-INV-000245", "total": 59000 },
  "changed_fields": null,
  "base_version": null
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "accepted_up_to": 1042,
    "rejected": [{ "seq": 1039, "code": "E_VALIDATION", "message": "الكمية المرتجعة أكبر من المباعة" }]
  }
}
```

`worker_id` (outer field) is the worker who performed the action; the server checks it against `workers`, the device's `max_role` and
the permission matrix (`role_can`, a SQL copy of `permissions.ts`). A sales invoice is ONE record with its children embedded
(`lines`, `payments`, `stock_movements`, `party_ledger`, `cash_movements`); the server checks that totals, payments and ledger rows
agree and that the number starts with the device prefix, then inserts everything atomically. Returns (`sales_returns`: lines, payments and the three ledgers embedded), voids (`voids`: the reversing ledger rows embedded) and customer receipts are bundles in the same way: the server re-computes the refund share of every returned line from the invoice, caps the quantity at sold − already returned (there is no return period: any age is accepted; a purchase return may point at purchase lines of several invoices of the same supplier, or have no invoice at all (`purchaseReturnWithoutInvoice`; its value must be the last price from that supplier unless the worker has `editReturnValue`, and the goods leave stock at that value); a manager's return without invoice may have many lines: each product must have been sold before on a posted invoice and its returned quantity, over every return, may not pass what was sold), copies `unit_cost` from the original line, and checks that a void's rows are exactly the negation of the invoice's. A void targets a sales invoice (`void`), a sales return (`voidReturn`) or a purchase invoice (`voidPurchase`, manager only), an expense (`voidExpense`) or a payroll advance/deduction (`managePayroll`); an expense's or advance's cash comes back into the box of the shift open now (`shift_id`), and a deduction of a paid month or an advance a later salary took is refused. A sales invoice's cash share goes back out of the drawer of the shift open on the deleting device (`shift_id`; every cash row on that drawer, the sum equals the original). A purchase invoice is refused when it is old-system history, has a posted purchase return line, or when any of its goods is no longer on the shelf; the server then works the product's average cost out again with `reverse_moving_average`. A shift is pushed twice (open, then closed): the server updates the open row exactly once on close, recomputes the expected cash from the shift's own movements on its drawer, and refuses a count/variance that does not match or a big difference without a manager's approval and note. Expenses and cash transfers are bundles with their cash movements embedded (an expense with `source = 'owner'` was paid from outside the box: no account and no cash movement; the only active expense type is «مصروفات محل») (a cashier may only use his device's drawer, and only move it to the safe). Tables not yet pushable
(`sync_tables.push_action` is null) are added with their command.
Workers: `sync_tables.push_action = manageUsers` (managers only), and a manager login on a device below the manager level is refused.
Passwords never reach a device (docs/SECURITY.md §2): offline login uses a verifier made on the device after one online login.
Cost on sales: devices below manager level send cost 0; the server sets `unit_cost` on the invoice lines and stock movements from the product's
current cost (purchase invoices keep it as a moving average, phase 7, and also set the sale price per line).
Rules: documents/ledgers `insert … on conflict (id) do nothing`; master data field-merge with `base_version`;
allow-listed tables only; role check per action uses the same matrix as `src/domain/permissions.ts`.

### `pull_changes(after_seq bigint, max_rows int default 1000)`

Returns `{ ok, data: { rows: [ { table, record } ], last_seq, has_more } }` ordered by `server_seq`, company-scoped,
filtered by device kind (phones get 90 days of documents, no cost fields unless `max_role = 'manager'`).
Phase 3 status: cost fields are stripped for non-manager devices; the 90-day / 13-month document window is not applied yet
(volume is ~20k invoices a year) and is added before the first phone goes live. Devices below `manager` cannot know `unit_cost`,
so lines they sell carry cost 0 until the server fills it in (open item, decided with the cashier screens in phase 6).

### Login RPCs (owner decision 2026-10-17: no activation code, no PIN)

- `login_device(p_username, p_password, p_device_name, p_kind)`: first call of a new browser (its own random Supabase Auth user). A correct password registers a manager device (prefix `K` + a counter) and returns `{ device_id, company_id, prefix, max_role, worker_id, must_change }`. Wrong → `E_LOGIN`; 5 wrong tries → `E_LOCKED` for 15 minutes.
- `verify_worker_login(p_username, p_password)`: a registered device checks a worker's password (online login); returns `{ worker_id, company_id, must_change }`.
- `set_worker_login(p_actor, p_worker, p_username, p_password)`: gives a worker a login (username once) or changes the password. Allowed for the worker themselves or for `manageUsers`.
- `bootstrap_admin()`: service role only; creates `admin` / `admin` (must change) for a company that has no login yet.

### `revoke_device(device_id uuid)` — manager only

Sets `revoked_at`; that device's next call gets `E_DEVICE_REVOKED`.

### `report_categories(p_from date, p_to date)` — manager devices only

Sales by product category for the period (imported history included): per category `qty`, `revenue` (after the invoice discount share, returns subtracted), `cost`, `profit`, `invoices`, plus the stock it ties up (`items`, `stock_value`), and `days` = revenue per day × category for the chart. A product's category is its current one; lines without a product count under category `null`.

### `report_payroll(p_from date, p_to date)` — manager devices only

Per worker what was advanced, deducted and paid in the period (`total`, `by_worker`, newest 1000 `entries`). `report_expenses` also returns `payroll` = net salaries paid (advances are not expenses).

### `report_expenses(p_from date, p_to date)` — manager devices only

Posted expenses of the period (imported ones included): `total`, `by_category`, `by_account` (null = imported, no cash account), `by_day` and the newest 500 in `list`.

### `report_returns(p_from date, p_to date)` — manager devices only

Posted returns of the period (Cairo days, voided ones left out), device documents and the imported history (`LG-RET-` / `LG-PRT-` numbers) together: `sales` and `purchases`, each with `total {count, amount}`, `legacy_count`, `by_day`, `by_product` (qty in base units, top 300), the 500 newest in `list`, and `by_reason` + `by_method` (sales; imported returns have reason `unknown` and are split by how they were paid) or `by_supplier` (purchases). The tab «المرتجعات» is the permission `report.returns` (managers; a permission group must be given it explicitly).

### Purchase screen permissions

A new product is accepted only from a worker with `addProduct` (manager always, storekeeper by default, a permission group can take it away). A supplier row is accepted from a worker with `addSupplier` when it is new; changing an existing supplier needs `settings`. The purchase invoice carries `supplier_ref` (the supplier's paper number) and the invoice discount as line discounts (their sum is `purchase_invoices.discount`).

### `search_legacy_sales(p_from, p_to, p_number, p_customer, p_min, p_max, p_method, p_product, p_kind, p_offset)` — manager devices only

Read-only search over the imported OpenSourcePOS sales (`legacy_sales`), 100 rows a page, newest first. Returns `{matched, rows[]}` with numbers `LG-INV-<id>` / `LG-RET-<id>`. `legacy_sale_detail(p_id)` returns one sale with its lines. Used by the «التاريخ القديم» switch of the sales invoices screen (needs the internet).

### `report_purchases_suppliers(p_from date, p_to date, p_supplier uuid default null)` — manager devices only

Per supplier with purchases in the period (device invoices and the imported archive): `invoices`, `total`, `list` (the newest 100 invoices: number, day, total) and `top` (5 products by net amount). `p_supplier` limits it to one supplier. Same period limit as the other reports.

### `report_safe(p_from date, p_to date)` — manager devices only

«الخزنة»: all the money in minus all the money out for the period (Cairo days, ≤ 400), on a cash basis. Money is cash, card, InstaPay, wallet and other; credit and owner-paid parts are not money (the owner-paid amount comes back as a note, `owner_paid`). Cash comes from the cash ledger of every account (transfers between accounts are left out; adjustments and deletes come back as signed `adjust` lines); non-cash money comes from posted sales and purchase payments, customer receipts and supplier payments; the old OpenSourcePOS sales and purchases count with their cash, card and other columns. Also returns `cash_now` (one number: every cash movement of the company, on any account, all time; the shop has one box) and `returns_today` (today's posted sales returns plus the sales invoices deleted today). Needs the permission `report.safe`.

### `product_usage(p_product_id uuid)` — manager devices only

What touches a product, as counts: `sales`, `sales_returns`, `purchases`, `purchase_returns`, `movements`, `adjustments`, `legacy_sales`, `legacy_purchases` (imported history, found through `products.legacy_item_id`) and `stock_milli`. The product screen asks it (internet needed) before offering «حذف الصنف». A push that sets `deleted_at` on a product with any count or stock is refused with `E_IN_USE`, except an **archive**: a product with history is accepted at stock 0 for a worker with `archiveProduct` (otherwise `E_FORBIDDEN`; with stock `E_IN_USE`). Clearing `deleted_at` on a product with history (restore) also needs `archiveProduct`.

### `report_product_history(p_product uuid, p_from date, p_to date, p_offset int)` — manager devices only

Every movement of one product (period ≤ 3660 days, 500 rows per page, newest first): `{at, doc_type, number, party, in_qty, out_qty, balance, legacy}`. Device movements come from `stock_movements`; imported OpenSourcePOS lines (which never produced movements) are listed with `legacy: true`. Balances run backwards from today's balance, and imported rows continue backwards from the opening quantity.

### `report_sales_summary(p_from date, p_to date)` / `report_profit(p_from, p_to)` / `report_purchases(p_from, p_to)` / `report_exceptions(p_from, p_to)` / `report_devices()` — manager devices only

`report_purchases` splits purchases by where the money came from: `safe` (cash method), `owner` (paid from the owner's pocket, payments method `owner`), `other` (card, instapay, wallet, other), `credit`, plus returns and later supplier payments, in total and per supplier.
Each returns `{ ok, data, generated_at }`; a cashier device gets `E_FORBIDDEN`, a period over 400 days `E_VALIDATION`. Days are Cairo calendar days.
Every report is also a `report_*_core(company, …)` function (service role only) so the import validator can compare it with OpenSourcePOS.

- Sales: per day invoices / gross / returns / net, totals, payments by method, by cashier, count of legacy (OSPOS) invoices; voided invoices are out.
- Profit: lines sold (after their share of the invoice discount) − cost (`unit_cost` per base unit × qty × factor), returns take both back; approximate by design.
- Exceptions: voids, reprints, no-sale opens (with approver), discounts on new invoices, stock adjustments with approver, shift variances.
- Devices: last seen, app version, open shift, client errors in the last 24 h.
  Customer and supplier statements are computed on the device from the ledgers (`src/db/statement.ts`); stock on hand also comes from the device.

### `import_batch(kind text, rows jsonb)` — service role only

Used by `tools/ospos-import`. `kind` is a synced table name, `rows` ≤ 1000 full records (all rows share the same keys, `company_id` included).
Raises unless `auth.role() = 'service_role'`. Idempotent (`on conflict (id) do nothing`); unknown table or column → `E_VALIDATION`.

## 5. Storage

- Bucket `product-images`, public read. Path `<company_id>/<product_id>.webp`, 256 px, ≤ 40 KB.
- Upload only from devices with `max_role = 'manager'` (policy on `storage.objects`). Devices cache images with the
  service worker (cache-first) so photos show offline.

## 6. Internal command API (`src/db/commands`)

Every command: validates with `src/domain` → one Dexie transaction (document + lines + payments + ledger rows +
outbox + audit) → returns a result. Commands never throw for business errors; they return
`{ ok: false, code, message }`. They throw only for programming errors.

| Command                                                       | Input (main fields)                                                                                                                                                                              | Output                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postSale`                                                    | cart lines, customerId?, payments[], invoiceDiscount?                                                                                                                                            | `{ ok, id, number, changeDue }`                                                                                                                                                                                                                                                              |
| `holdCart` / `resumeCart`                                     | cart                                                                                                                                                                                             | cart id                                                                                                                                                                                                                                                                                      |
| `postSalesReturn`                                             | originalInvoiceId?, lines[{originalLineId, qtyMilli, condition}], shiftId, cashAccountId                                                                                                         | `{ ok, id, number, total, cash, credit }`; refund split by the original payment mix (credit share lowers the debt, the rest is cash from the drawer, `DRAWER_SHORT` if the drawer lacks it); past `return.periodDays` a cashier needs a `returnAfterPeriod` token; no invoice = manager only |
| `deleteMaster` | kind (`customer` / `supplier` / `worker`), id | `{ ok }` soft delete (`deletedAt`) + audit row; refused with `HAS_BALANCE` (balance ≠ 0), `HAS_ADVANCE` (worker owes an advance), `SELF`, `E_FORBIDDEN` (customers/suppliers need `settings`, workers `manageUsers`); the server refuses the same with triggers |
| `voidExpense` | expenseId, reason (`mistake`) | `{ ok, id, number }` (`voidExpense`); the cash back into the open shift's box; `NO_SHIFT` / `ALREADY_VOIDED` / `LEGACY` |
| `editExpense` | expenseId, categoryId, amount | `{ ok, id, number }` of the new expense: void (`edited`) + new expense in one transaction; any failure leaves nothing changed |
| `voidPayrollEntry` | entryId, reason (`mistake`) | `{ ok, id, number }` (`managePayroll`); an advance's cash back into the open shift's box; `MONTH_PAID` / `ADVANCE_TAKEN` / `NO_SHIFT` / `ALREADY_VOIDED` |
| `editPayrollEntry` | entryId, amount, note | `{ ok, id, number }` of the new entry: void (`edited`) + new advance/deduction (same worker, month, account) in one transaction |
| `voidInvoice`                                                 | invoiceId, reason, shiftId?                                                                                                                                                                      | `{ ok, id, number }` manager only (`void`, shown as «حذف فاتورة بيع»); any age; exact reversing rows, the cash from the open shift's drawer; refused with `HAS_RETURNS` / `ALREADY_VOIDED` / `NO_SHIFT`                                                                                      |
| `voidPurchaseInvoice`                                         | invoiceId, reason                                                                                                                                                                                | `{ ok, id, number }` manager only (`voidPurchase`); stock, supplier credit and safe cash reversed, average cost recomputed; refused with `HAS_RETURNS` / `STOCK_SOLD` / `LEGACY` / `ALREADY_VOIDED`                                                                                          |
| `postCustomerReceipt`                                         | customerId, amount, method, reference?, shiftId, cashAccountId                                                                                                                                   | `{ ok, id, number, balanceAfter }`; cash enters the drawer, card/InstaPay need a reference                                                                                                                                                                                                   |
| `postPurchase`                                                | supplierId, warehouseId, lines[{productId, productUnitId?, unitFactorMilli, qtyMilli, unitCost, discount, newSalePrice? (manager only)}], payments[{method, amount, reference?, cashAccountId?}] | `{ ok, id, number, total }`; payments must equal the total; credit = we owe the supplier; the server fixes each movement's cost per base unit and the product's moving average (`moving_average`, same maths as `movingAverage`)                                                             |
| `postPurchaseReturn`                                          | supplierId, originalInvoiceId?, warehouseId, lines[{originalLineId, qtyMilli}], refundTo (`credit`\|`cash`), cashAccountId?                                                                      | `{ ok, id, number, total }`; goes out at the invoice cost, capped at bought − returned; no invoice = manager only                                                                                                                                                                            |
| `postSupplierPayment`                                         | supplierId, amount, method, reference?, cashAccountId?                                                                                                                                           | `{ ok, id, number, balanceAfter }` manager only; cash leaves the chosen account                                                                                                                                                                                                              |
| `postStockAdjustment`                                         | warehouseId, reason (`count`\|`damaged`\|`lost`\|`found`\|`other`), lines[{productId, qtyDeltaMilli}], approvalTokens[]                                                                          | `{ ok, id, number, total }`; above `stock.approvalAbove` a non-manager needs a `stockAdjustment` token; the server re-checks with the real cost                                                                                                                                              |
| `postExpense`                                                 | categoryId, amount, cashAccountId, shiftId?                                                                                                                                                      | `{ ok, id, number }`; one cash movement −amount; a cashier only from his own drawer and within what it holds (`DRAWER_SHORT`)                                                                                                                                                                |
| `postCashTransfer`                                            | fromAccountId, toAccountId, amount, shiftId?                                                                                                                                                     | `{ ok, id, number }`; two cash rows that cancel out; a cashier only drawer → safe                                                                                                                                                                                                            |
| `saveExpenseCategory`                                         | name, icon?, id?, baseVersion?                                                                                                                                                                   | manager only                                                                                                                                                                                                                                                                                 |
| `openShift`                                                   | cashAccountId, openingFloat                                                                                                                                                                      | `{ ok, id, number }`                                                                                                                                                                                                                                                                         |
| `previewClose` / `closeShift`                                 | shiftId, counted[{value,count}], note?                                                                                                                                                           | blind close: the cashier counts first, then sees expected / counted / variance; above `shift.varianceAbove` a manager's `cashAdjustment` PIN token and a note are required (`APPROVAL_REQUIRED`, `NOTE_REQUIRED`); the shift row is updated and re-queued                                    |
| `saveProduct`                                                 | fields, `barcodes[]`, `packUnit` (one), `baseVersion`                                                                                                                                            | `{ ok, id, version }` (one transaction: product, units, barcodes, search words)                                                                                                                                                                                                              |
| `saveCategory` / `saveCustomer` / `saveSupplier`              | fields + `baseVersion`                                                                                                                                                                           | `{ ok, id, version }`                                                                                                                                                                                                                                                                        |
| `holdCart` / `resumeCart` / `discardCart` / `saveCurrentCart` | cart                                                                                                                                                                                             | local only (never synced); the open cart autosaves on every change                                                                                                                                                                                                                           |
| `noSale` / `reprintInvoice`                                   | reason + token / invoice id                                                                                                                                                                      | audit rows `no_sale` and `invoice_reprinted`; reprints are marked "copy"                                                                                                                                                                                                                     |
| `saveSetting`                                                 | key, value                                                                                                                                                                                       | managers only; one row per key (deterministic id)                                                                                                                                                                                                                                            |
| `addCustomer`                                                 | name, phone                                                                                                                                                                                      | cashier or manager; limit 0, no discount; the server refuses anything else from a cashier                                                                                                                                                                                                    |
| `saveWorker`                                                  | name, role, active, groupId, monthlySalary + `baseVersion` (logins are made by `set_worker_login`, not here)                                                                                     | `{ ok, id, version }` (managers only; `manageUsers`)                                                                                                                                                                                                                                         |

## 7. Rate limiting and abuse

- Client: one `ingest_batch` in flight, one `pull_changes` in flight, backoff on errors.
- Server: RPCs check batch size and per-device call frequency (≤ 60 calls/min) and raise `E_RATE_LIMIT`.
- Supabase Auth's built-in rate limits protect device sign-in.

## 8. Third-party services

| Service                       | Purpose                   | Env vars                                                  | Where used           | When it is down                           |
| ----------------------------- | ------------------------- | --------------------------------------------------------- | -------------------- | ----------------------------------------- |
| Supabase                      | Auth, Postgres, Storage   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public)    | browser              | devices keep selling; sync resumes later  |
| Cloudflare Pages              | hosting the built app     | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (CI only) | GitHub Actions       | installed PWA keeps working; updates wait |
| GitHub Actions                | CI/CD, nightly backup     | repo secrets (`docs/SECURITY.md` §3)                      | GitHub               | no deploys; app unaffected                |
| OpenSourcePOS (until cutover) | data source for migration | none (browser session)                                    | `tools/ospos-export` | export waits                              |
| ETA e-receipt                 | deferred                  | —                                                         | —                    | —                                         |

## Payroll entries (push)

`payroll_entries` (action `managePayroll`): `ingest_payroll_bundle` checks the number prefix (`ADV`/`DED`/`SAL`), the worker, the month, that an advance (and a salary with net > 0) embeds exactly one cash movement from a non-drawer account, that a deduction embeds none and is refused for an already paid month, and recomputes the salary slip on the server: net = max(0, salary − month deductions − advances since the last salary − carry in), carry out = the shortfall. A mismatching slip or a second salary for the month is `E_VALIDATION`.
