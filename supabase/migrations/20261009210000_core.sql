-- Core: sequence, helpers, structure and people tables (docs/DATABASE.md §3, §4.1)
create sequence server_seq;

create function bump_server_seq() returns trigger
language plpgsql as $$
begin
  new.server_seq := nextval('server_seq');
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create table companies (
  id uuid primary key,
  company_id uuid not null,
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
  tax_number text,
  logo_path text
);

create table branches (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  name text not null
);

create table warehouses (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  branch_id uuid references branches (id),
  name text not null,
  kind text not null default 'main' check (kind in ('main', 'showroom', 'scrap')),
  legacy_location_id int
);

create table devices (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  branch_id uuid references branches (id),
  auth_user_id uuid unique,
  name text not null,
  prefix text not null check (prefix ~ '^[A-Z0-9]{2,3}$'),
  kind text not null check (kind in ('pc', 'mobile')),
  max_role text not null check (max_role in ('cashier', 'storekeeper', 'manager')),
  last_seen_at timestamptz,
  app_version text,
  revoked_at timestamptz,
  unique (company_id, prefix)
);

create table workers (
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
  role text not null check (role in ('cashier', 'storekeeper', 'manager')),
  pin_hash text,
  pin_salt text,
  photo_path text,
  active bool not null default true,
  legacy_employee_id int
);

create table settings (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  key text not null,
  value jsonb,
  unique (company_id, key)
);

create table cash_accounts (
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
  kind text not null check (kind in ('drawer', 'safe', 'bank', 'wallet', 'card_clearing')),
  owner_device_id uuid references devices (id)
);

create table expense_categories (
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
  icon text
);

-- one-time activation codes for new devices; never visible to clients (docs/SECURITY.md §2)
create table device_activations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices (id),
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table device_activations enable row level security;
revoke all on device_activations from anon, authenticated;

-- helpers used by RLS and every RPC (security definer so they can read devices under RLS)
create function current_device() returns devices
language sql stable security definer set search_path = public as $$
  select d.* from devices d where d.auth_user_id = auth.uid()
$$;

create function current_company() returns uuid
language sql stable security definer set search_path = public as $$
  select d.company_id from devices d where d.auth_user_id = auth.uid() and d.revoked_at is null
$$;

create function is_manager_device() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select d.max_role = 'manager' from devices d
                   where d.auth_user_id = auth.uid() and d.revoked_at is null), false)
$$;

create function assert_device_active() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  d devices;
begin
  select * into d from devices where auth_user_id = auth.uid();
  if not found or d.revoked_at is not null then
    raise exception 'E_DEVICE_REVOKED' using errcode = 'P0001';
  end if;
end $$;

revoke execute on function current_device(), current_company(), is_manager_device(), assert_device_active() from public, anon;
grant execute on function current_device(), current_company(), is_manager_device(), assert_device_active() to authenticated;

-- triggers, indexes, RLS and grants for every table above
do $$
declare
  t text;
  cost_tables text[] := array[''];
begin
  foreach t in array array['companies', 'branches', 'warehouses', 'devices', 'workers', 'settings', 'cash_accounts', 'expense_categories'] loop
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
