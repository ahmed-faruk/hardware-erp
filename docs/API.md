# API

There is no custom backend server. The app talks to two APIs:
1. **Internal command API** (in the browser): `src/db/commands/*` — every screen writes data only through these.
2. **Supabase API** (cloud): Auth for devices, Postgres RPC functions for sync, Storage for product images.
Selling never waits for either cloud call.

## 1. Base configuration
| Env | Supabase URL | Notes |
| --- | --- | --- |
| Development | `http://127.0.0.1:54321` (from `supabase start`) | |
| Preview | `VITE_SUPABASE_URL` of the staging project | set per GitHub variable |
| Production | `VITE_SUPABASE_URL` of the production project | |
Client: `@supabase/supabase-js` created once in `src/sync/supabase.ts`. Format: JSON. Times: ISO 8601 with offset.
RPC versioning: the client sends `app_version`; the server accepts the current and two previous minor versions.

## 2. Authentication
- Each shop device has one Supabase Auth user (email + password) created by the manager on first setup.
  The device signs in once online; supabase-js refreshes the JWT; offline the app keeps working with the cached session.
- Workers are NOT Supabase users. They log in locally by photo + PIN; every row they create carries `created_by`.
- Every RPC begins with `assert_device_active()` → raises `E_DEVICE_REVOKED` for revoked devices.
- `service_role` is used only by `tools/ospos-import` on the Mac (env file, never committed, never in the bundle).

## 3. Response envelope (all RPCs)
```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "E_VALIDATION", "message": "Arabic text safe to show", "details": { } } }
```
| Code | Meaning | Client reaction |
| --- | --- | --- |
| `E_VALIDATION` | payload shape or business rule failed | mark row rejected, show on manager sync screen |
| `E_FORBIDDEN` | worker role or device role not allowed | mark rejected, audit |
| `E_DEVICE_REVOKED` | device revoked by manager | stop sync, wipe local data at next start |
| `E_VERSION_TOO_OLD` | app older than accepted versions | show "update needed", keep selling, retry after update |
| `E_CONFLICT` | master-data field conflict | server value kept, conflict logged |
| `E_RATE_LIMIT` | too many calls | back off |
| `E_INTERNAL` | unexpected | retry with backoff, log `client_errors` |
Network errors are not envelopes: retry 5 s, 30 s, 2 min, 10 min, then every 10 min.

## 4. RPC endpoints (`supabase.rpc(name, args)`)
### `ping()`
Returns `{ ok, data: { server_time } }`. Every 30 s for connectivity and clock skew.

### `ingest_batch(device_id uuid, app_version text, rows jsonb)`
Push outbox rows in order. Limits: ≤ 200 rows, ≤ 1 MB, one batch in flight per device.
Request row:
```json
{ "seq": 1042, "device_seq": 1042, "table": "sales_invoices", "op": "upsert",
  "record": { "id": "0190f…", "number": "K1-INV-000245", "total": 59000 },
  "changed_fields": null, "base_version": null }
```
Response:
```json
{ "ok": true, "data": { "accepted_up_to": 1042,
  "rejected": [ { "seq": 1039, "code": "E_VALIDATION", "message": "الكمية المرتجعة أكبر من المباعة" } ] } }
```
`worker_id` (outer field) is the worker who performed the action; the server checks it against `workers`, the device's `max_role` and
the permission matrix (`role_can`, a SQL copy of `permissions.ts`). A sales invoice is ONE record with its children embedded
(`lines`, `payments`, `stock_movements`, `party_ledger`, `cash_movements`); the server checks that totals, payments and ledger rows
agree and that the number starts with the device prefix, then inserts everything atomically. Tables not yet pushable
(`sync_tables.push_action` is null) are added with their command.
Rules: documents/ledgers `insert … on conflict (id) do nothing`; master data field-merge with `base_version`;
allow-listed tables only; role check per action uses the same matrix as `src/domain/permissions.ts`.

### `pull_changes(after_seq bigint, max_rows int default 1000)`
Returns `{ ok, data: { rows: [ { table, record } ], last_seq, has_more } }` ordered by `server_seq`, company-scoped,
filtered by device kind (phones get 90 days of documents, no cost fields unless `max_role = 'manager'`).
Phase 3 status: cost fields are stripped for non-manager devices; the 90-day / 13-month document window is not applied yet
(volume is ~20k invoices a year) and is added before the first phone goes live. Devices below `manager` cannot know `unit_cost`,
so lines they sell carry cost 0 until the server fills it in (open item, decided with the cashier screens in phase 6).

### `claim_device_activation(code text)`
First call of a new device. The manager registers the device on the Mac (`npm run device:add -- --name … --prefix K1 --kind pc
--role manager`), which prints a 10-character code (valid 24 h, single use, only its sha256 is stored). The new device signs up
its own Supabase Auth user (random password kept on the device), then calls this RPC; the code links `auth.uid()` to the
`devices` row. Wrong, used or expired code → `E_VALIDATION`.

### `revoke_device(device_id uuid)` — manager only
Sets `revoked_at`; that device's next call gets `E_DEVICE_REVOKED`.

### `report_sales_summary(from date, to date)` / `report_stock_valuation(at date)` / `report_party_statement(party_type text, party_id uuid, from date, to date)` — manager only
Server-side versions of the reports that need legacy archive data or all devices. Same numbers as local reports for
synced data.

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

| Command | Input (main fields) | Output |
| --- | --- | --- |
| `postSale` | cart lines, customerId?, payments[], invoiceDiscount?, approvals[] | `{ ok, id, number, changeDue }` |
| `holdCart` / `resumeCart` | cart | cart id |
| `postSalesReturn` | originalInvoiceId?, lines[{originalLineId, qty, condition}], refundMethod, reason? | `{ ok, id, number }` |
| `voidDocument` | targetType, targetId, reason, managerApproval | `{ ok, id }` |
| `postCustomerReceipt` | customerId, amount, method, reference? | `{ ok, id, number, newBalance }` |
| `postPurchase` | supplierId, lines[{productId, unitId, qty, unitCost, discount}], payments[] | `{ ok, id, number }` |
| `postPurchaseReturn` | supplierId, originalInvoiceId?, lines[], refund | `{ ok, id, number }` |
| `postSupplierPayment` | supplierId, amount, method, reference? | `{ ok, id, number }` |
| `postStockAdjustment` | warehouseId, lines[{productId, qtyDelta}], reasonCode, approval? | `{ ok, id, number }` |
| `postExpense` | categoryId, amount, notes | `{ ok, id, number }` |
| `openShift` / `closeShift` | float / counted breakdown | `{ ok, id, variance? }` |
| `saveProduct` / `saveCustomer` / `saveSupplier` | fields + `baseVersion` | `{ ok, id, version }` |
| `approveWithPin` | action, managerPin | `{ ok, approvalToken }` (single use, expires in 2 min) |

## 7. Rate limiting and abuse
- Client: one `ingest_batch` in flight, one `pull_changes` in flight, backoff on errors.
- Server: RPCs check batch size and per-device call frequency (≤ 60 calls/min) and raise `E_RATE_LIMIT`.
- Supabase Auth's built-in rate limits protect device sign-in.

## 8. Third-party services
| Service | Purpose | Env vars | Where used | When it is down |
| --- | --- | --- | --- | --- |
| Supabase | Auth, Postgres, Storage | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public) | browser | devices keep selling; sync resumes later |
| Cloudflare Pages | hosting the built app | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (CI only) | GitHub Actions | installed PWA keeps working; updates wait |
| GitHub Actions | CI/CD, nightly backup | repo secrets (`docs/SECURITY.md` §3) | GitHub | no deploys; app unaffected |
| OpenSourcePOS (until cutover) | data source for migration | none (browser session) | `tools/ospos-export` | export waits |
| ETA e-receipt | deferred | — | — | — |
