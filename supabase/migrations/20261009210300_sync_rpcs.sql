-- Sync RPCs: ping, ingest_batch, pull_changes, device activation (docs/API.md §3, §4; skill supabase-backend §4)

-- which tables travel, who may push them, and which columns are cost data
create table sync_tables (
  table_name text primary key,
  kind text not null check (kind in ('master', 'document', 'child', 'ledger', 'system')),
  push_action text,
  pull text not null default 'all' check (pull in ('all', 'manager', 'none')),
  cost_columns text[] not null default '{}'
);
alter table sync_tables enable row level security;
revoke all on sync_tables from anon, authenticated;

-- push_action: a src/domain/permissions.ts action, 'any' (any active worker), or null (not pushed on its own)
insert into sync_tables (table_name, kind, push_action, pull, cost_columns) values
  ('companies', 'master', null, 'all', '{}'),
  ('branches', 'master', null, 'all', '{}'),
  ('warehouses', 'master', null, 'all', '{}'),
  ('devices', 'master', null, 'all', '{}'),
  ('workers', 'master', null, 'all', '{}'),
  ('settings', 'master', null, 'all', '{}'),
  ('cash_accounts', 'master', null, 'all', '{}'),
  ('expense_categories', 'master', null, 'all', '{}'),
  ('suppliers', 'master', 'settings', 'all', '{}'),
  ('customers', 'master', 'settings', 'all', '{}'),
  ('categories', 'master', 'editProductData', 'all', '{}'),
  ('products', 'master', 'editProductData', 'all', '{unit_cost}'),
  ('product_units', 'master', 'editProductData', 'all', '{}'),
  ('barcodes', 'master', 'editProductData', 'all', '{}'),
  ('shifts', 'document', 'sell', 'all', '{}'),
  ('sales_invoices', 'document', 'sell', 'all', '{}'),
  ('sales_invoice_lines', 'child', null, 'all', '{unit_cost}'),
  ('payments', 'child', null, 'all', '{}'),
  ('stock_movements', 'ledger', null, 'all', '{unit_cost}'),
  ('party_ledger', 'ledger', null, 'all', '{}'),
  ('cash_movements', 'ledger', null, 'all', '{}'),
  ('sales_returns', 'document', null, 'all', '{}'),
  ('sales_return_lines', 'child', null, 'all', '{unit_cost}'),
  ('purchase_invoices', 'document', null, 'all', '{}'),
  ('purchase_invoice_lines', 'child', null, 'all', '{unit_cost}'),
  ('purchase_returns', 'document', null, 'all', '{}'),
  ('purchase_return_lines', 'child', null, 'all', '{unit_cost}'),
  ('customer_receipts', 'document', null, 'all', '{}'),
  ('supplier_payments', 'document', null, 'all', '{}'),
  ('stock_adjustments', 'document', null, 'all', '{}'),
  ('stock_adjustment_lines', 'child', null, 'all', '{unit_cost}'),
  ('expenses', 'document', null, 'all', '{}'),
  ('cash_transfers', 'document', null, 'all', '{}'),
  ('voids', 'document', null, 'all', '{}'),
  ('openings', 'document', null, 'all', '{}'),
  ('audit_log', 'system', 'any', 'manager', '{}'),
  ('client_errors', 'system', null, 'none', '{}');

-- SQL copy of src/domain/permissions.ts (a unit test keeps them identical)
create function role_can(p_role text, p_action text) returns text
language sql immutable set search_path = public as $$
  select coalesce(
    (select m.access
       from (values
         ('cashier', 'sell', 'yes'),
         ('cashier', 'holdCart', 'yes'),
         ('cashier', 'returnWithInvoice', 'yes'),
         ('cashier', 'discountWithinLimit', 'yes'),
         ('cashier', 'discountOverLimit', 'pin'),
         ('cashier', 'priceOverride', 'pin'),
         ('cashier', 'creditOverLimit', 'pin'),
         ('cashier', 'noSaleDrawer', 'pin'),
         ('cashier', 'customerReceipt', 'yes'),
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

create function ping() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_device_active();
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('server_time', now()));
end $$;

-- insert one record; duplicates (same id) are ignored but must belong to the same company
create function ingest_insert(p_table text, p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  bad text;
  cols text;
  n int;
  existing uuid;
begin
  rec := (p_rec - 'server_seq' - 'updated_at') || jsonb_build_object('company_id', p_company, 'device_id', p_device);
  select string_agg(k, ', ') into bad
    from jsonb_object_keys(rec) k
   where k not in (select attname::text from pg_attribute
                    where attrelid = ('public.' || quote_ident(p_table))::regclass and attnum > 0 and not attisdropped);
  if bad is not null then
    raise exception 'E_VALIDATION:حقول غير معروفة';
  end if;
  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(rec) k;
  execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing',
                 p_table, cols, cols, p_table) using rec;
  get diagnostics n = row_count;
  if n = 0 then
    execute format('select company_id from %I where id = $1', p_table) into existing using (rec ->> 'id')::uuid;
    if existing is distinct from p_company then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
end $$;

-- master data: insert when new, field-level merge when it exists
create function ingest_master(p_table text, p_rec jsonb, p_changed jsonb, p_base int, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur jsonb;
  fields text[];
  f text;
  same boolean := true;
  conflict boolean;
  client_updated timestamptz;
  apply_change boolean;
  cols text;
begin
  execute format('select to_jsonb(x) from %I x where x.id = $1', p_table) into cur using (p_rec ->> 'id')::uuid;
  if cur is null then
    perform ingest_insert(p_table, p_rec, p_company, p_device);
    return;
  end if;
  if (cur ->> 'company_id')::uuid is distinct from p_company then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if p_changed is null or jsonb_typeof(p_changed) <> 'array' or jsonb_array_length(p_changed) = 0 then
    return; -- a re-sent creation of an existing record
  end if;
  select array_agg(v) into fields from jsonb_array_elements_text(p_changed) v;
  foreach f in array fields loop
    if f in ('id', 'company_id', 'device_id', 'server_seq', 'version', 'created_at', 'updated_at', 'deleted_at')
       and f <> 'deleted_at' then
      raise exception 'E_VALIDATION:حقل غير قابل للتعديل';
    end if;
    if not (cur ? f) then
      raise exception 'E_VALIDATION:حقول غير معروفة';
    end if;
    if (cur -> f) is distinct from (p_rec -> f) then
      same := false;
    end if;
  end loop;
  if same then
    return; -- already applied (idempotent re-send)
  end if;
  conflict := p_base is distinct from (cur ->> 'version')::int;
  client_updated := coalesce((p_rec ->> 'updated_at')::timestamptz, '-infinity');
  apply_change := (not conflict) or client_updated > (cur ->> 'updated_at')::timestamptz;
  if conflict then
    insert into audit_log (id, company_id, device_id, action, entity, entity_id, before, after, occurred_at)
    values (gen_random_uuid(), p_company, p_device, 'sync_conflict:' || case when apply_change then 'client_won' else 'server_won' end,
            p_table, (p_rec ->> 'id')::uuid, cur, p_rec, now());
  end if;
  if apply_change then
    select string_agg(format('%I', x), ', ') into cols from unnest(fields) x;
    execute format('update %I set (%s) = (select %s from jsonb_populate_record(null::%I, $1)) where id = $2',
                   p_table, cols, cols, p_table) using p_rec, (p_rec ->> 'id')::uuid;
  end if;
end $$;

-- a sales invoice arrives as ONE record with its children embedded (atomic, checkable)
create function ingest_sales_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  e jsonb;
  inv_id uuid := (p_rec ->> 'id')::uuid;
  line_sum bigint := 0;
  alloc_sum bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  base_qty bigint;
  moved bigint;
begin
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:الفاتورة بدون أصناف';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    if (e ->> 'qty')::bigint <= 0 or (e ->> 'net_amount')::bigint < 0 or (e ->> 'alloc_discount')::bigint < 0
       or (e ->> 'unit_price')::bigint < 0 then
      raise exception 'E_VALIDATION:قيمة غير صالحة';
    end if;
    line_sum := line_sum + (e ->> 'net_amount')::bigint - (e ->> 'alloc_discount')::bigint;
    alloc_sum := alloc_sum + (e ->> 'alloc_discount')::bigint;
    if (e ->> 'invoice_id')::uuid is distinct from inv_id then
      raise exception 'E_VALIDATION:صنف لا يخص الفاتورة';
    end if;
  end loop;
  if line_sum + (inv ->> 'tax_total')::bigint <> (inv ->> 'total')::bigint then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;
  if alloc_sum <> (inv ->> 'invoice_discount')::bigint then
    raise exception 'E_VALIDATION:الخصم لا يطابق الأصناف';
  end if;
  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 then
      raise exception 'E_VALIDATION:قيمة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint; end if;
    if e ->> 'method' = 'cash' then cash_sum := cash_sum + (e ->> 'amount')::bigint; end if;
    if e ->> 'document_id' is distinct from inv_id::text or e ->> 'document_type' <> 'sales_invoice' then
      raise exception 'E_VALIDATION:دفعة لا تخص الفاتورة';
    end if;
  end loop;
  if pay_sum <> (inv ->> 'total')::bigint then
    raise exception 'E_VALIDATION:المدفوع لا يطابق الإجمالي';
  end if;
  if credit_sum > 0 and (inv ->> 'customer_id') is null then
    raise exception 'E_VALIDATION:الآجل يحتاج عميل';
  end if;
  -- ledger rows must match the document (no movement without a document, no document without movements)
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> credit_sum then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق الآجل';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> cash_sum then
    raise exception 'E_VALIDATION:حركة الدرج لا تطابق النقدي';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    if e ->> 'product_id' is not null and exists (select 1 from products p where p.id = (e ->> 'product_id')::uuid and p.type = 'stock') then
      base_qty := ((e ->> 'qty')::bigint * (e ->> 'unit_factor')::bigint) / 1000;
      select coalesce(sum(- (x ->> 'qty')::bigint), 0) into moved
        from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id';
      if moved <> base_qty then
        raise exception 'E_VALIDATION:حركة المخزون لا تطابق الصنف';
      end if;
    end if;
  end loop;
  for e in select * from jsonb_array_elements(smov || pled || cmov) loop
    if e ->> 'doc_id' is distinct from inv_id::text then
      raise exception 'E_VALIDATION:حركة لا تخص الفاتورة';
    end if;
  end loop;

  perform ingest_insert('sales_invoices', inv, p_company, p_device);
  for e in select * from jsonb_array_elements(lines) loop perform ingest_insert('sales_invoice_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;

create function ingest_row(p_device devices, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  st sync_tables;
  rec jsonb := p_row -> 'record';
  w workers;
begin
  select * into st from sync_tables where table_name = p_row ->> 'table' and push_action is not null;
  if not found or p_row ->> 'op' is distinct from 'upsert' or jsonb_typeof(rec) <> 'object' or rec ->> 'id' is null then
    raise exception 'E_VALIDATION:جدول غير مسموح';
  end if;
  select * into w from workers
   where id = (rec ->> 'created_by')::uuid and company_id = p_device.company_id and active and deleted_at is null;
  if not found then
    raise exception 'E_FORBIDDEN:عامل غير معروف';
  end if;
  if w.role = 'manager' and p_device.max_role <> 'manager' then
    raise exception 'E_FORBIDDEN:الجهاز لا يسمح بهذا الدور';
  end if;
  if st.push_action <> 'any' and role_can(w.role, st.push_action) = 'no' then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;

create function ingest_batch(p_device_id uuid, p_app_version text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d devices;
  r jsonb;
  last_seq bigint := 0;
  rejected jsonb := '[]';
  code text;
  msg text;
begin
  perform assert_device_active();
  perform pg_advisory_xact_lock(7300001); -- writers commit in server_seq order, so pull never skips a row
  select * into d from current_device();
  if d.id is distinct from p_device_id then
    raise exception 'E_FORBIDDEN';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'دفعة غير صالحة'));
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    last_seq := greatest(last_seq, coalesce((r ->> 'seq')::bigint, 0));
    begin
      perform ingest_row(d, r);
    exception when others then
      if sqlerrm like 'E\_%:%' then
        code := split_part(sqlerrm, ':', 1);
        msg := substr(sqlerrm, length(code) + 2);
      else
        code := 'E_VALIDATION';
        msg := 'بيانات غير صالحة';
      end if;
      rejected := rejected || jsonb_build_object('seq', (r ->> 'seq')::bigint, 'code', code, 'message', msg);
    end;
  end loop;
  if d.last_seen_at is null or d.last_seen_at < now() - interval '5 minutes' or d.app_version is distinct from p_app_version then
    update devices set last_seen_at = now(), app_version = p_app_version where id = d.id;
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('accepted_up_to', last_seq, 'rejected', rejected));
end $$;

create function pull_changes(p_after_seq bigint, p_max_rows int default 1000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d devices;
  st sync_tables;
  q text := '';
  expr text;
  c text;
  arr jsonb;
  has_more boolean;
  lim int := least(greatest(coalesce(p_max_rows, 1000), 1), 1000);
  is_mgr boolean;
begin
  perform assert_device_active();
  select * into d from current_device();
  is_mgr := d.max_role = 'manager';
  for st in select * from sync_tables where pull = 'all' or (pull = 'manager' and is_mgr) order by table_name loop
    expr := 'to_jsonb(x)';
    if not is_mgr then
      foreach c in array st.cost_columns loop
        expr := expr || format(' - %L', c);
      end loop;
    end if;
    q := q || case when q = '' then '' else ' union all ' end
         || format('(select %L::text as t, x.server_seq as s, %s as rec from %I x where x.company_id = $1 and x.server_seq > $2 order by x.server_seq limit $3)',
                   st.table_name, expr, st.table_name);
  end loop;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''table'', t, ''record'', rec) order by s), ''[]''::jsonb) from (select * from (%s) u order by s limit $3) z', q)
    into arr using d.company_id, p_after_seq, lim + 1;
  has_more := jsonb_array_length(arr) > lim;
  if has_more then
    select jsonb_agg(e order by ord) into arr from jsonb_array_elements(arr) with ordinality t (e, ord) where ord <= lim;
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'rows', arr,
    'last_seq', coalesce((arr -> -1 -> 'record' ->> 'server_seq')::bigint, p_after_seq),
    'has_more', has_more));
end $$;

-- a new device proves it holds the one-time code printed on the Mac, then links its auth user
create function claim_device_activation(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a device_activations;
  d devices;
begin
  if auth.uid() is null then
    raise exception 'E_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(7300001);
  select * into a from device_activations
   where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex') and used_at is null and expires_at > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'الكود غير صحيح أو انتهى'));
  end if;
  select * into d from devices where id = a.device_id and revoked_at is null and auth_user_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'الكود غير صحيح أو انتهى'));
  end if;
  update devices set auth_user_id = auth.uid() where id = d.id;
  update device_activations set used_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('device_id', d.id, 'company_id', d.company_id,
                            'prefix', d.prefix, 'max_role', d.max_role));
end $$;

create function revoke_device(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me devices;
begin
  perform assert_device_active();
  perform pg_advisory_xact_lock(7300001);
  select * into me from current_device();
  if me.max_role <> 'manager' then
    raise exception 'E_FORBIDDEN';
  end if;
  update devices set revoked_at = now() where id = p_device_id and company_id = me.company_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('device_id', p_device_id));
end $$;

-- migration only: skeleton, filled in phase 4
create function import_batch(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'E_FORBIDDEN';
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('inserted', 0));
end $$;

revoke execute on function role_can(text, text), ingest_insert(text, jsonb, uuid, uuid), ingest_master(text, jsonb, jsonb, int, uuid, uuid),
  ingest_sales_bundle(jsonb, uuid, uuid), ingest_row(devices, jsonb), ingest_batch(uuid, text, jsonb), pull_changes(bigint, int),
  ping(), claim_device_activation(text), revoke_device(uuid), import_batch(text, jsonb) from public, anon, authenticated;
grant execute on function ingest_batch(uuid, text, jsonb), pull_changes(bigint, int), ping(), claim_device_activation(text),
  revoke_device(uuid) to authenticated;
grant execute on function import_batch(text, jsonb) to authenticated, service_role;
