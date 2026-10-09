-- Documents, payments, ledgers and system tables (docs/DATABASE.md §4.4 - §4.6)
create table shifts (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  worker_id uuid references workers (id),
  cash_account_id uuid references cash_accounts (id),
  opened_at timestamptz not null,
  opening_float bigint not null default 0,
  closed_at timestamptz,
  counted_total bigint,
  counted_breakdown jsonb,
  expected_total bigint,
  variance bigint,
  close_note text,
  status text not null default 'open' check (status in ('open', 'closed')),
  unique (company_id, number)
);

create table sales_invoices (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  customer_id uuid references customers (id),
  warehouse_id uuid references warehouses (id),
  subtotal bigint not null default 0,
  line_discount_total bigint not null default 0,
  invoice_discount bigint not null default 0,
  tax_total bigint not null default 0,
  cash_rounding bigint not null default 0,
  total bigint not null default 0,
  cash_tendered bigint not null default 0,
  change_due bigint not null default 0,
  unique (company_id, number)
);

create table sales_invoice_lines (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  invoice_id uuid not null references sales_invoices (id),
  line_no int not null,
  product_id uuid references products (id),
  product_unit_id uuid references product_units (id),
  unit_factor bigint not null default 1000,
  qty bigint not null,
  unit_price bigint not null default 0,
  line_discount bigint not null default 0,
  alloc_discount bigint not null default 0,
  tax_amount bigint not null default 0,
  net_amount bigint not null default 0,
  unit_cost bigint not null default 0,
  warehouse_id uuid references warehouses (id),
  legacy_text text
);

create table sales_returns (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  original_invoice_id uuid references sales_invoices (id),
  customer_id uuid references customers (id),
  total bigint not null default 0,
  refund_method text not null check (refund_method in ('cash', 'credit', 'store_credit', 'exchange')),
  reason text,
  approved_by uuid references workers (id),
  unique (company_id, number)
);

create table sales_return_lines (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  return_id uuid not null references sales_returns (id),
  original_line_id uuid references sales_invoice_lines (id),
  product_id uuid references products (id),
  qty bigint not null,
  unit_refund bigint not null default 0,
  net_amount bigint not null default 0,
  unit_cost bigint not null default 0,
  condition text not null default 'good' check (condition in ('good', 'damaged')),
  warehouse_id uuid references warehouses (id)
);

create table purchase_invoices (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  supplier_id uuid not null references suppliers (id),
  supplier_ref text,
  warehouse_id uuid references warehouses (id),
  subtotal bigint not null default 0,
  discount bigint not null default 0,
  total bigint not null default 0,
  unique (company_id, number)
);

create table purchase_invoice_lines (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  invoice_id uuid not null references purchase_invoices (id),
  line_no int not null,
  product_id uuid references products (id),
  product_unit_id uuid references product_units (id),
  unit_factor bigint not null default 1000,
  qty bigint not null,
  unit_cost bigint not null default 0,
  discount bigint not null default 0,
  net_amount bigint not null default 0,
  legacy_text text
);

create table purchase_returns (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  original_invoice_id uuid references purchase_invoices (id),
  supplier_id uuid not null references suppliers (id),
  warehouse_id uuid references warehouses (id),
  subtotal bigint not null default 0,
  discount bigint not null default 0,
  total bigint not null default 0,
  unique (company_id, number)
);

create table purchase_return_lines (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  return_id uuid not null references purchase_returns (id),
  line_no int not null,
  product_id uuid references products (id),
  product_unit_id uuid references product_units (id),
  unit_factor bigint not null default 1000,
  qty bigint not null,
  unit_cost bigint not null default 0,
  discount bigint not null default 0,
  net_amount bigint not null default 0,
  legacy_text text
);

create table customer_receipts (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  customer_id uuid not null references customers (id),
  amount bigint not null check (amount > 0),
  method text not null,
  reference text,
  unique (company_id, number)
);

create table supplier_payments (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  supplier_id uuid not null references suppliers (id),
  amount bigint not null check (amount > 0),
  method text not null,
  reference text,
  unique (company_id, number)
);

create table stock_adjustments (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  warehouse_id uuid not null references warehouses (id),
  reason_code text not null,
  approved_by uuid references workers (id),
  unique (company_id, number)
);

create table stock_adjustment_lines (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  adjustment_id uuid not null references stock_adjustments (id),
  product_id uuid not null references products (id),
  qty_delta bigint not null,
  unit_cost bigint not null default 0
);

create table expenses (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  category_id uuid not null references expense_categories (id),
  amount bigint not null check (amount > 0),
  cash_account_id uuid references cash_accounts (id),
  supplier_id uuid references suppliers (id),
  unique (company_id, number)
);

create table cash_transfers (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  from_account_id uuid not null references cash_accounts (id),
  to_account_id uuid not null references cash_accounts (id),
  amount bigint not null check (amount > 0),
  unique (company_id, number)
);

create table voids (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  approved_by uuid references workers (id),
  unique (company_id, number)
);

create table openings (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  kind text not null check (kind in ('stock', 'customers', 'suppliers', 'cash')),
  approved_by uuid references workers (id),
  unique (company_id, number)
);

create table payments (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  document_type text not null,
  document_id uuid not null,
  method text not null check (method in ('cash', 'credit', 'card', 'instapay', 'wallet', 'other')),
  amount bigint not null check (amount > 0),
  reference text,
  cash_account_id uuid references cash_accounts (id)
);

create table stock_movements (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  product_id uuid not null references products (id),
  warehouse_id uuid not null references warehouses (id),
  qty bigint not null,
  unit_cost bigint not null default 0,
  doc_type text not null,
  doc_id uuid not null,
  line_id uuid,
  occurred_at timestamptz not null
);

create table party_ledger (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  party_type text not null check (party_type in ('customer', 'supplier')),
  party_id uuid not null,
  amount bigint not null,
  doc_type text not null,
  doc_id uuid not null,
  occurred_at timestamptz not null
);

create table cash_movements (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  cash_account_id uuid not null references cash_accounts (id),
  shift_id uuid references shifts (id),
  amount bigint not null,
  method text not null,
  doc_type text not null,
  doc_id uuid not null,
  occurred_at timestamptz not null
);

create table audit_log (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  worker_id uuid references workers (id),
  approved_by uuid references workers (id),
  occurred_at timestamptz not null
);

create table client_errors (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  app_version text,
  message text not null,
  stack text,
  context jsonb,
  occurred_at timestamptz not null
);

create index stock_movements_pw_idx on stock_movements (product_id, warehouse_id);
create index party_ledger_party_idx on party_ledger (party_type, party_id);
create index cash_movements_acc_idx on cash_movements (cash_account_id, occurred_at);
create index payments_doc_idx on payments (document_type, document_id);
create index sales_invoices_issued_idx on sales_invoices (issued_at);
create index sales_invoice_lines_invoice_idx on sales_invoice_lines (invoice_id);

-- triggers, indexes, RLS and grants for every table above
do $$
declare
  t text;
  cost_tables text[] := array['sales_invoice_lines', 'sales_return_lines', 'purchase_invoice_lines', 'purchase_return_lines', 'stock_adjustment_lines', 'stock_movements'];
begin
  foreach t in array array['shifts', 'sales_invoices', 'sales_invoice_lines', 'sales_returns', 'sales_return_lines', 'purchase_invoices', 'purchase_invoice_lines', 'purchase_returns', 'purchase_return_lines', 'customer_receipts', 'supplier_payments', 'stock_adjustments', 'stock_adjustment_lines', 'expenses', 'cash_transfers', 'voids', 'openings', 'payments', 'stock_movements', 'party_ledger', 'cash_movements', 'audit_log', 'client_errors'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function bump_server_seq()', t || '_seq', t);
    execute format('create index %I on %I (company_id, server_seq)', t || '_company_seq_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    if t = any (cost_tables) then
      execute format('create policy select_own_company_manager on %I for select to authenticated using (company_id = current_company() and is_manager_device())', t);
    else
      execute format('create policy select_own_company on %I for select to authenticated using (company_id = current_company())', t);
    end if;
  end loop;
end $$;
