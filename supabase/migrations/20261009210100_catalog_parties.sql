-- Catalog and parties (docs/DATABASE.md §4.2, §4.3)
create table suppliers (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  name text not null,
  contact_name text,
  phone text,
  address text,
  notes text,
  is_expense_supplier bool not null default false,
  active bool not null default true,
  legacy_person_id int
);

create table customers (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  name text not null,
  phone text,
  address text,
  company text,
  notes text,
  credit_limit bigint not null default 0,
  default_discount_bp int not null default 0,
  photo_path text,
  active bool not null default true,
  legacy_person_id int
);

create table categories (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  parent_id uuid references categories (id),
  name text not null,
  color_token text,
  icon text,
  sort int not null default 0
);

create table products (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  sku text,
  name text not null,
  category_id uuid references categories (id),
  type text not null default 'stock' check (type in ('stock', 'service')),
  base_unit_name text not null,
  qty_decimals int not null default 0 check (qty_decimals between 0 and 3),
  price bigint not null default 0 check (price >= 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  reorder_level bigint not null default 0,
  default_supplier_id uuid references suppliers (id),
  image_path text,
  extra_fields jsonb,
  active bool not null default true,
  legacy_item_id int
);
create unique index products_sku_idx on products (company_id, sku) where sku is not null and deleted_at is null;

create table product_units (
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
  name text not null,
  factor bigint not null check (factor > 0),
  price bigint,
  is_default_sale bool not null default false,
  is_default_purchase bool not null default false
);

create table barcodes (
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
  product_unit_id uuid references product_units (id),
  code text not null
);
create unique index barcodes_code_idx on barcodes (company_id, code) where deleted_at is null;

-- triggers, indexes, RLS and grants for every table above
do $$
declare
  t text;
  cost_tables text[] := array['products'];
begin
  foreach t in array array['suppliers', 'customers', 'categories', 'products', 'product_units', 'barcodes'] loop
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

-- cashier devices read products through this view (no unit_cost); managers may also read the base table
create view products_public with (security_barrier = true) as
  select id, company_id, device_id, created_by, created_at, updated_at, version, deleted_at, server_seq,
         sku, name, category_id, type, base_unit_name, qty_decimals, price, reorder_level,
         default_supplier_id, image_path, extra_fields, active, legacy_item_id
  from products
  where company_id = current_company();
revoke all on products_public from anon, authenticated;
grant select on products_public to authenticated;
