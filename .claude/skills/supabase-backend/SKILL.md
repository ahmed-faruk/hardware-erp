---
name: supabase-backend
description: Supabase conventions for this POS - SQL migrations, RLS, SECURITY DEFINER RPCs (ingest_batch, pull_changes), device auth, pgTAP tests, free-tier limits. Use for anything under supabase/.
---

# Supabase backend

Table definitions: `docs/DATABASE.md`. RPC contracts and error codes: `docs/API.md`. Rules: `docs/SECURITY.md`.

## 1. Conventions
- Tables snake_case, plural. Every synced table has:
  `id uuid primary key, company_id uuid not null, device_id uuid, created_by uuid, created_at timestamptz,
   updated_at timestamptz, version int not null default 1, deleted_at timestamptz,
   server_seq bigint not null default nextval('server_seq')`.
- Money `bigint` (piasters), quantity `bigint` (milli-units). Never `numeric` for app values, never `float`.
- One trigger `bump_server_seq()` on insert/update sets `server_seq = nextval('server_seq')`, `updated_at = now()`.
- Migrations: `supabase migration new <name>`; forward-only; expand/contract (add column → deploy app → drop old later).
  A migration merged to `main` must work with the currently deployed app.

## 2. Auth model (MVP)
- Each shop device signs in ONCE with a **device account** created by the manager (Supabase Auth email+password,
  synthetic email like `k1@devices.example.com`, email confirmation off). JWT carries the device.
- Workers do NOT have Supabase logins in the MVP. They pick their photo and enter a PIN; the PIN hash (PBKDF2) is
  synced to devices and checked locally. Every row carries `created_by` (worker id).
- `devices(id, company_id, auth_user_id, prefix, max_role, revoked_at)`. Revoked device → all RPCs refuse.
- Helper: `current_device()` returns the device row for `auth.uid()`; `current_company()` its company.

## 3. Row Level Security
- `alter table ... enable row level security;` on EVERY table, in the same migration that creates it.
- Clients get SELECT only, scoped by company:
```sql
create policy select_own_company on products for select
  using (company_id = current_company());
```
- Cost/profit columns: expose products to cashier devices through a view without `unit_cost`
  (`products_public`), and grant the base table only when `current_device().max_role = 'manager'`.
- No INSERT/UPDATE/DELETE grants to `authenticated` on business tables. All writes go through RPC.

## 4. RPCs
All `security definer`, `set search_path = public`, and start with `perform assert_device_active();`.
- `ingest_batch(device_id uuid, app_version text, rows jsonb) returns jsonb`
  - for each row in order: check table is allow-listed, validate shape, check `company_id`,
    check the worker's role allows the action (same table as `src/domain/permissions.ts`),
    `insert ... on conflict (id) do nothing` for documents/ledgers, field-merge update for master data.
  - returns `{ accepted_up_to, rejected: [...] }`. Never raise for one bad row; collect it.
- `pull_changes(after_seq bigint, max_rows int) returns jsonb` — rows from allow-listed tables with
  `server_seq > after_seq` for the device's company, ordered by `server_seq`.
- `ping() returns timestamptz` — server time, used for connectivity + clock skew.
- `import_batch(...)` — migration only, callable ONLY with the service role (check `auth.role() = 'service_role'`).

## 5. Storage
Bucket `product-images` (public read, 256 px WebP, path `<company_id>/<product_id>.webp`).
Writes only through the manager device (policy on `storage.objects` checking `current_device().max_role`).

## 6. Tests (pgTAP, `supabase/tests/*.sql`, run with `supabase test db`)
Minimum per table/RPC:
- cashier device cannot select `unit_cost` / base products table.
- device of company A cannot read or write company B rows.
- revoked device: every RPC raises.
- `ingest_batch` with the same rows twice → one row each.
- rejected row does not stop the rest of the batch.

## 7. Free tier facts to respect (verify at supabase.com/pricing before relying on them)
- 500 MB database per project, no automatic backups, project pauses after 1 week of inactivity, 2 active free projects.
- So: nightly `pg_dump` in GitHub Actions; monthly size check; never load-test the real project (use `supabase start`).

## 8. Never
- `service_role` key in the web app, Vite env, tests or CI build.
- `security definer` function without `set search_path`.
- Business logic only in SQL that the client can't reproduce offline — rules live in `src/domain`,
  RPC validation re-checks them.
