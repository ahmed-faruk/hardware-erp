-- Permission groups: every screen and button is an action; a group maps actions to yes / pin / no and is given to a worker.
-- Without a group a worker keeps his role's defaults. With a group the group is the whole truth (a missing action is no).
-- A manager always keeps the administration screens, whatever his group says (no lock-out).

create function permissions_valid(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object' and not exists (select 1 from jsonb_each(p) e where e.value not in ('"yes"', '"pin"', '"no"'))
$$;

create table permission_groups (
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
  permissions jsonb not null default '{}' check (permissions_valid(permissions))
);
create trigger permission_groups_seq before insert or update on permission_groups for each row execute function bump_server_seq();
create index permission_groups_company_seq_idx on permission_groups (company_id, server_seq);
alter table permission_groups enable row level security;
revoke all on permission_groups from anon, authenticated;
grant select on permission_groups to authenticated;
create policy select_own_company on permission_groups for select to authenticated using (company_id = current_company());
alter table workers add column group_id uuid references permission_groups (id);

insert into sync_tables (table_name, kind, push_action, pull, cost_columns) values ('permission_groups', 'master', 'manageGroups', 'all', '{}');

create or replace function role_can(p_role text, p_action text) returns text
language sql immutable set search_path = public as $$
  select coalesce(
    (select m.access
       from (values
         ('cashier', 'view.sell', 'yes'),
         ('cashier', 'sell', 'yes'),
         ('cashier', 'holdCart', 'yes'),
         ('cashier', 'returnWithInvoice', 'yes'),
         ('cashier', 'discountWithinLimit', 'yes'),
         ('cashier', 'discountOverLimit', 'pin'),
         ('cashier', 'priceOverride', 'pin'),
         ('cashier', 'creditOverLimit', 'pin'),
         ('cashier', 'noSaleDrawer', 'pin'),
         ('cashier', 'customerReceipt', 'yes'),
         ('cashier', 'addCustomer', 'yes'),
         ('cashier', 'returnAfterPeriod', 'pin'),
         ('cashier', 'recordExpense', 'yes'),
         ('cashier', 'cashTransfer', 'yes'),
         ('storekeeper', 'view.products', 'yes'),
         ('storekeeper', 'view.categories', 'yes'),
         ('storekeeper', 'view.purchases', 'yes'),
         ('storekeeper', 'view.stock', 'yes'),
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

create function worker_can(p_worker uuid, p_action text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  w workers;
  perms jsonb;
begin
  select * into w from workers where id = p_worker;
  if not found then
    return 'no';
  end if;
  if w.role = 'manager' and p_action in ('view.workers', 'manageUsers', 'manageGroups', 'view.settings', 'settings') then
    return 'yes';
  end if;
  if w.group_id is not null then
    select g.permissions into perms from permission_groups g where g.id = w.group_id and g.deleted_at is null;
    if found then
      return coalesce(perms ->> p_action, 'no');
    end if;
  end if;
  return role_can(w.role, p_action);
end $$;
revoke execute on function worker_can(uuid, text) from public, anon, authenticated;


create or replace function ingest_sales_return_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ret jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  fixed_lines jsonb := '[]';
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  fixed_smov jsonb := '[]';
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  ret_id uuid := (p_rec ->> 'id')::uuid;
  orig_id uuid := nullif(p_rec ->> 'original_invoice_id', '')::uuid;
  orig sales_invoices;
  ol sales_invoice_lines;
  e jsonb;
  m jsonb;
  seen jsonb := '{}';
  already bigint;
  q bigint;
  final bigint;
  expected bigint;
  base bigint;
  total bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  want_kind text;
  days int;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-RET-%' then
    raise exception 'E_VALIDATION:رقم المرتجع لا يخص الجهاز';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:المرتجع بدون أصناف';
  end if;
  if orig_id is null and worker_can(p_worker.id, 'returnWithoutInvoice') <> 'yes' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة للمدير فقط';
  end if;

  if orig_id is not null then
    select * into orig from sales_invoices where id = orig_id and company_id = p_company;
    if not found or orig.status <> 'posted' then
      raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
    end if;
    select coalesce((select (value #>> '{}')::int from settings where company_id = p_company and key = 'return.periodDays' and deleted_at is null), 30) into days;
    if worker_can(p_worker.id, 'returnAfterPeriod') <> 'yes'
       and (now() at time zone 'Africa/Cairo')::date - (orig.issued_at at time zone 'Africa/Cairo')::date > days
       and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'returnAfterPeriod') = 'yes' and a.company_id = p_company and a.active) then
      raise exception 'E_FORBIDDEN:المرتجع بعد المهلة يحتاج موافقة المدير';
    end if;
  end if;

  for e in select * from jsonb_array_elements(lines) loop
    q := (e ->> 'qty')::bigint;
    if q <= 0 then
      raise exception 'E_VALIDATION:كمية غير صالحة';
    end if;
    want_kind := case when e ->> 'condition' = 'damaged' then 'scrap' else 'main' end;
    if (e ->> 'return_id')::uuid is distinct from ret_id then
      raise exception 'E_VALIDATION:سطر لا يخص المرتجع';
    end if;
    if e ->> 'original_line_id' is not null then
      if orig_id is null then
        raise exception 'E_VALIDATION:سطر بدون فاتورة';
      end if;
      select * into ol from sales_invoice_lines where id = (e ->> 'original_line_id')::uuid and invoice_id = orig_id and company_id = p_company;
      if not found then
        raise exception 'E_VALIDATION:سطر غير موجود في الفاتورة';
      end if;
      select coalesce(sum(qty), 0) into already from sales_return_lines where original_line_id = ol.id;
      already := already + coalesce((seen ->> ol.id::text)::bigint, 0);
      if already + q > ol.qty then
        raise exception 'E_VALIDATION:الكمية المرتجعة أكبر من المباعة';
      end if;
      final := ol.net_amount - ol.alloc_discount;
      expected := ((final * (already + q) * 2 + ol.qty) / (2 * ol.qty)) - ((final * already * 2 + ol.qty) / (2 * ol.qty));
      if (e ->> 'net_amount')::bigint <> expected then
        raise exception 'E_VALIDATION:قيمة المرتجع لا تطابق الفاتورة';
      end if;
      seen := jsonb_set(seen, array[ol.id::text], to_jsonb(coalesce((seen ->> ol.id::text)::bigint, 0) + q));
      if (q * ol.unit_factor) % 1000 <> 0 then
        raise exception 'E_VALIDATION:كمية لا تتحول لوحدة أساسية';
      end if;
      base := q * ol.unit_factor / 1000;
      e := e || jsonb_build_object('unit_cost', ol.unit_cost, 'product_id', ol.product_id);
    else
      if (e ->> 'net_amount')::bigint < 0 or e ->> 'product_id' is null then
        raise exception 'E_VALIDATION:سطر غير صالح';
      end if;
      base := q;
      e := e || jsonb_build_object('unit_cost', coalesce((select pr.unit_cost from products pr where pr.id = (e ->> 'product_id')::uuid and pr.company_id = p_company), 0));
    end if;
    total := total + (e ->> 'net_amount')::bigint;
    fixed_lines := fixed_lines || jsonb_build_array(e);
    -- one stock movement per line, in base units, to the main (good) or scrap (damaged) warehouse, at the line's cost
    select x into m from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id' limit 1;
    if m is null or (m ->> 'qty')::bigint <> base
       or not exists (select 1 from warehouses w where w.id = (m ->> 'warehouse_id')::uuid and w.company_id = p_company and w.kind = want_kind)
       or (m ->> 'product_id')::uuid is distinct from (e ->> 'product_id')::uuid then
      raise exception 'E_VALIDATION:حركة المخزون لا تطابق المرتجع';
    end if;
    fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', (e ->> 'unit_cost')::bigint));
  end loop;
  if jsonb_array_length(smov) <> jsonb_array_length(lines) then
    raise exception 'E_VALIDATION:حركات مخزون زيادة';
  end if;
  if total <> (ret ->> 'total')::bigint then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;

  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 or e ->> 'document_id' is distinct from ret_id::text or e ->> 'document_type' <> 'sales_return' then
      raise exception 'E_VALIDATION:دفعة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint; else cash_sum := cash_sum + (e ->> 'amount')::bigint; end if;
  end loop;
  if pay_sum <> total then
    raise exception 'E_VALIDATION:الرد لا يطابق الإجمالي';
  end if;
  if credit_sum > 0 and (ret ->> 'customer_id') is null then
    raise exception 'E_VALIDATION:تخفيض المديونية يحتاج عميل';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> -credit_sum then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق الرد';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> -cash_sum then
    raise exception 'E_VALIDATION:حركة الدرج لا تطابق الرد';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from ret_id::text or e ->> 'doc_type' <> 'sales_return' then
      raise exception 'E_VALIDATION:حركة لا تخص المرتجع';
    end if;
  end loop;

  perform ingest_insert('sales_returns', ret, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('sales_return_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_void_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  vd jsonb := p_rec - 'stock_movements' - 'party_ledger' - 'cash_movements';
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  void_id uuid := (p_rec ->> 'id')::uuid;
  target uuid := (p_rec ->> 'target_id')::uuid;
  inv sales_invoices;
  e jsonb;
begin
  if worker_can(p_worker.id, 'void') <> 'yes' then
    raise exception 'E_FORBIDDEN:الإلغاء للمدير فقط';
  end if;
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-VOID-%' or p_rec ->> 'target_type' <> 'sales_invoice' then
    raise exception 'E_VALIDATION:مستند إلغاء غير صالح';
  end if;
  if coalesce(p_rec ->> 'reason', '') = '' then
    raise exception 'E_VALIDATION:سبب الإلغاء مطلوب';
  end if;
  select * into inv from sales_invoices where id = target and company_id = p_company;
  if not found or inv.status <> 'posted' then
    raise exception 'E_VALIDATION:الفاتورة غير صالحة للإلغاء';
  end if;
  if exists (select 1 from sales_returns where original_invoice_id = target and company_id = p_company) then
    raise exception 'E_VALIDATION:الفاتورة عليها مرتجع';
  end if;
  -- the reversing rows must be exactly the negation of what the invoice wrote: same keys, opposite totals, same row counts
  if (select count(*) from stock_movements where doc_id = target) <> jsonb_array_length(smov)
     or (select count(*) from party_ledger where doc_id = target) <> jsonb_array_length(pled)
     or (select count(*) from cash_movements where doc_id = target) <> jsonb_array_length(cmov) then
    raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
  end if;
  if exists (
       select 1 from (select product_id, warehouse_id, sum(qty) q from stock_movements where doc_id = target group by 1, 2) o
       full join (select (x ->> 'product_id')::uuid product_id, (x ->> 'warehouse_id')::uuid warehouse_id, sum((x ->> 'qty')::bigint) q from jsonb_array_elements(smov) x group by 1, 2) r
         using (product_id, warehouse_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0)
     or exists (
       select 1 from (select party_id, sum(amount) q from party_ledger where doc_id = target group by 1) o
       full join (select (x ->> 'party_id')::uuid party_id, sum((x ->> 'amount')::bigint) q from jsonb_array_elements(pled) x group by 1) r using (party_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0)
     or exists (
       select 1 from (select cash_account_id, sum(amount) q from cash_movements where doc_id = target group by 1) o
       full join (select (x ->> 'cash_account_id')::uuid cash_account_id, sum((x ->> 'amount')::bigint) q from jsonb_array_elements(cmov) x group by 1) r using (cash_account_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0) then
    raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
  end if;
  for e in select * from jsonb_array_elements(smov || pled || cmov) loop
    if e ->> 'doc_id' is distinct from void_id::text or e ->> 'doc_type' <> 'void' then
      raise exception 'E_VALIDATION:حركة لا تخص الإلغاء';
    end if;
  end loop;
  perform ingest_insert('voids', vd, p_company, p_device);
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
  update sales_invoices set status = 'voided', voided_by = void_id where id = target;
end $$;


create or replace function ingest_purchase_return_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ret jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  ret_id uuid := (p_rec ->> 'id')::uuid;
  orig_id uuid := nullif(p_rec ->> 'original_invoice_id', '')::uuid;
  e jsonb;
  m jsonb;
  ol purchase_invoice_lines;
  pr products;
  q bigint;
  already bigint;
  expected bigint;
  net bigint;
  base bigint;
  cost bigint;
  total bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  seen jsonb := '{}';
  fixed_lines jsonb := '[]';
  fixed_smov jsonb := '[]';
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-PRT-%' then
    raise exception 'E_VALIDATION:رقم المرتجع لا يخص الجهاز';
  end if;
  if not exists (select 1 from suppliers s where s.id = (p_rec ->> 'supplier_id')::uuid and s.company_id = p_company) then
    raise exception 'E_VALIDATION:مورد غير موجود';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:مرتجع بدون أصناف';
  end if;
  if orig_id is null and worker_can(p_worker.id, 'returnWithoutInvoice') <> 'yes' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة للمدير فقط';
  end if;
  if orig_id is not null and not exists (select 1 from purchase_invoices i where i.id = orig_id and i.company_id = p_company and i.supplier_id = (p_rec ->> 'supplier_id')::uuid and i.status = 'posted') then
    raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
  end if;

  for e in select * from jsonb_array_elements(lines) loop
    q := (e ->> 'qty')::bigint;
    if q <= 0 or (e ->> 'return_id')::uuid is distinct from ret_id then
      raise exception 'E_VALIDATION:سطر غير صالح';
    end if;
    if e ->> 'original_line_id' is not null then
      if orig_id is null then raise exception 'E_VALIDATION:سطر بدون فاتورة'; end if;
      select * into ol from purchase_invoice_lines where id = (e ->> 'original_line_id')::uuid and invoice_id = orig_id and company_id = p_company;
      if not found then raise exception 'E_VALIDATION:سطر غير موجود في الفاتورة'; end if;
      select coalesce(sum(qty), 0) into already from purchase_return_lines where original_line_id = ol.id;
      already := already + coalesce((seen ->> ol.id::text)::bigint, 0);
      if already + q > ol.qty then raise exception 'E_VALIDATION:الكمية المرتجعة أكبر من المشتراة'; end if;
      expected := ((ol.net_amount * (already + q) * 2 + ol.qty) / (2 * ol.qty)) - ((ol.net_amount * already * 2 + ol.qty) / (2 * ol.qty));
      if (e ->> 'net_amount')::bigint <> expected then raise exception 'E_VALIDATION:قيمة المرتجع لا تطابق الفاتورة'; end if;
      seen := jsonb_set(seen, array[ol.id::text], to_jsonb(coalesce((seen ->> ol.id::text)::bigint, 0) + q));
      base := q * ol.unit_factor / 1000;
      if (q * ol.unit_factor) % 1000 <> 0 then raise exception 'E_VALIDATION:كمية لا تتحول لوحدة أساسية'; end if;
      cost := line_cost_per_base(ol.net_amount, ol.qty * ol.unit_factor / 1000);
      e := e || jsonb_build_object('product_id', ol.product_id, 'unit_cost', ol.unit_cost, 'unit_factor', ol.unit_factor);
      net := expected;
    else
      if e ->> 'product_id' is null or (e ->> 'net_amount')::bigint < 0 then raise exception 'E_VALIDATION:سطر غير صالح'; end if;
      select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company;
      if not found then raise exception 'E_VALIDATION:صنف غير موجود'; end if;
      if (e ->> 'unit_factor')::bigint <> 1000 then raise exception 'E_VALIDATION:وحدة غير صالحة'; end if;
      base := q;
      cost := coalesce(pr.unit_cost, 0);
      net := (e ->> 'net_amount')::bigint;
    end if;
    total := total + net;
    fixed_lines := fixed_lines || jsonb_build_array(e);
    select * into pr from products where id = (e ->> 'product_id')::uuid;
    if pr.type = 'stock' then
      select x into m from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id' limit 1;
      if m is null or (m ->> 'qty')::bigint <> -base or (m ->> 'product_id')::uuid <> pr.id
         or m ->> 'doc_id' is distinct from ret_id::text or m ->> 'doc_type' <> 'purchase_return'
         or not exists (select 1 from warehouses w where w.id = (m ->> 'warehouse_id')::uuid and w.company_id = p_company and w.kind <> 'scrap') then
        raise exception 'E_VALIDATION:حركة المخزون لا تطابق المرتجع';
      end if;
      fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', cost));
    end if;
  end loop;
  if jsonb_array_length(smov) <> jsonb_array_length(fixed_smov) then
    raise exception 'E_VALIDATION:حركات مخزون زيادة';
  end if;
  if (ret ->> 'total')::bigint <> total then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;

  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 or e ->> 'document_id' is distinct from ret_id::text or e ->> 'document_type' <> 'purchase_return' then
      raise exception 'E_VALIDATION:دفعة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint;
    elsif e ->> 'method' = 'cash' then
      cash_sum := cash_sum + (e ->> 'amount')::bigint;
      if not exists (select 1 from cash_accounts a where a.id = (e ->> 'cash_account_id')::uuid and a.company_id = p_company) then
        raise exception 'E_VALIDATION:حساب نقدية غير صالح';
      end if;
    end if;
  end loop;
  if pay_sum <> total then raise exception 'E_VALIDATION:الرد لا يطابق الإجمالي'; end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> credit_sum
     or coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> cash_sum then
    raise exception 'E_VALIDATION:حركات الحساب لا تطابق الرد';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from ret_id::text or e ->> 'doc_type' <> 'purchase_return' then
      raise exception 'E_VALIDATION:حركة لا تخص المرتجع';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(pled) loop
    if (e ->> 'party_type') <> 'supplier' or (e ->> 'party_id')::uuid is distinct from (p_rec ->> 'supplier_id')::uuid then
      raise exception 'E_VALIDATION:حركة المورد غير صالحة';
    end if;
  end loop;

  perform ingest_insert('purchase_returns', ret, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('purchase_return_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_stock_adjustment_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  adj jsonb := p_rec - 'lines' - 'stock_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  adj_id uuid := (p_rec ->> 'id')::uuid;
  reason text := p_rec ->> 'reason_code';
  wh uuid := (p_rec ->> 'warehouse_id')::uuid;
  e jsonb;
  m jsonb;
  pr products;
  delta bigint;
  adj_value bigint := 0;
  threshold bigint;
  fixed_lines jsonb := '[]';
  fixed_smov jsonb := '[]';
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-ADJ-%' then
    raise exception 'E_VALIDATION:رقم التسوية لا يخص الجهاز';
  end if;
  if reason not in ('count', 'damaged', 'lost', 'found', 'other') then
    raise exception 'E_VALIDATION:سبب التسوية مطلوب';
  end if;
  if jsonb_array_length(lines) = 0 or jsonb_array_length(lines) <> jsonb_array_length(smov) then
    raise exception 'E_VALIDATION:تسوية غير مكتملة';
  end if;
  if not exists (select 1 from warehouses w where w.id = wh and w.company_id = p_company) then
    raise exception 'E_VALIDATION:مخزن غير صالح';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    delta := (e ->> 'qty_delta')::bigint;
    select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company and type = 'stock';
    if not found or delta = 0 or (e ->> 'adjustment_id')::uuid is distinct from adj_id then
      raise exception 'E_VALIDATION:سطر تسوية غير صالح';
    end if;
    if (reason in ('damaged', 'lost') and delta > 0) or (reason = 'found' and delta < 0) then
      raise exception 'E_VALIDATION:الكمية لا تناسب السبب';
    end if;
    select x into m from jsonb_array_elements(smov) x where x ->> 'product_id' = pr.id::text and (x ->> 'qty')::bigint = delta and x ->> 'doc_id' = adj_id::text and x ->> 'doc_type' = 'stock_adjustment' and (x ->> 'warehouse_id')::uuid = wh limit 1;
    if m is null then
      raise exception 'E_VALIDATION:حركة المخزون لا تطابق التسوية';
    end if;
    adj_value := adj_value + abs(delta) * coalesce(pr.unit_cost, 0) / 1000;
    fixed_lines := fixed_lines || jsonb_build_array(e || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
    fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
  end loop;
  select coalesce((select (value #>> '{}')::bigint from settings where company_id = p_company and key = 'stock.approvalAbove' and deleted_at is null), 50000) into threshold;
  if worker_can(p_worker.id, 'stockAdjustmentOverLimit') <> 'yes' and adj_value > threshold
     and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'stockAdjustmentOverLimit') = 'yes' and a.company_id = p_company and a.active) then
    raise exception 'E_FORBIDDEN:التسوية دي محتاجة موافقة المدير';
  end if;
  perform ingest_insert('stock_adjustments', adj, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('stock_adjustment_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_expense_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ex jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  eid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  acct cash_accounts;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-EXP-%' then
    raise exception 'E_VALIDATION:رقم المصروف لا يخص الجهاز';
  end if;
  if amount <= 0 or not exists (select 1 from expense_categories c where c.id = (p_rec ->> 'category_id')::uuid and c.company_id = p_company) then
    raise exception 'E_VALIDATION:مصروف غير صالح';
  end if;
  select * into acct from cash_accounts where id = (p_rec ->> 'cash_account_id')::uuid and company_id = p_company;
  if not found then
    raise exception 'E_VALIDATION:حساب نقدية غير صالح';
  end if;
  if worker_can(p_worker.id, 'expenseAnyAccount') <> 'yes' and not (acct.kind = 'drawer' and acct.owner_device_id = p_device) then
    raise exception 'E_FORBIDDEN:المصروف من درج الجهاز بس';
  end if;
  if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> -amount
     or (cmov -> 0 ->> 'cash_account_id')::uuid <> acct.id
     or cmov -> 0 ->> 'doc_id' is distinct from eid::text or cmov -> 0 ->> 'doc_type' <> 'expense' then
    raise exception 'E_VALIDATION:حركة النقدية لا تطابق المصروف';
  end if;
  perform ingest_insert('expenses', ex, p_company, p_device);
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_cash_transfer_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  tr jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  tid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  src cash_accounts;
  dst cash_accounts;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-XFR-%' then
    raise exception 'E_VALIDATION:رقم التوريد لا يخص الجهاز';
  end if;
  select * into src from cash_accounts where id = (p_rec ->> 'from_account_id')::uuid and company_id = p_company;
  select * into dst from cash_accounts where id = (p_rec ->> 'to_account_id')::uuid and company_id = p_company;
  if amount <= 0 or src.id is null or dst.id is null or src.id = dst.id then
    raise exception 'E_VALIDATION:توريد غير صالح';
  end if;
  if worker_can(p_worker.id, 'cashTransferAny') <> 'yes' and not (src.kind = 'drawer' and src.owner_device_id = p_device and dst.kind = 'safe') then
    raise exception 'E_FORBIDDEN:التوريد من درج الجهاز للخزنة بس';
  end if;
  if jsonb_array_length(cmov) <> 2
     or coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 1) <> 0
     or not exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid = src.id and (x ->> 'amount')::bigint = -amount)
     or not exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid = dst.id and (x ->> 'amount')::bigint = amount) then
    raise exception 'E_VALIDATION:حركات التوريد لا تطابق المبلغ';
  end if;
  for e in select * from jsonb_array_elements(cmov) loop
    if e ->> 'doc_id' is distinct from tid::text or e ->> 'doc_type' <> 'cash_transfer' then
      raise exception 'E_VALIDATION:حركة لا تخص التوريد';
    end if;
  end loop;
  perform ingest_insert('cash_transfers', tr, p_company, p_device);
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_cash_adjustment_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  adj jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  aid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  e jsonb;
begin
  if worker_can(p_worker.id, 'cashAdjustment') <> 'yes' then
    raise exception 'E_FORBIDDEN:التسوية للمدير فقط';
  end if;
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-CAJ-%' then
    raise exception 'E_VALIDATION:رقم التسوية لا يخص الجهاز';
  end if;
  if amount = 0 or not exists (select 1 from cash_accounts a where a.id = (p_rec ->> 'cash_account_id')::uuid and a.company_id = p_company) then
    raise exception 'E_VALIDATION:تسوية غير صالحة';
  end if;
  if (p_rec ->> 'reason_code') = 'other' and coalesce(p_rec ->> 'note', '') = '' then
    raise exception 'E_VALIDATION:الملاحظة مطلوبة';
  end if;
  if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> amount
     or (cmov -> 0 ->> 'cash_account_id')::uuid <> (p_rec ->> 'cash_account_id')::uuid
     or cmov -> 0 ->> 'doc_id' is distinct from aid::text or cmov -> 0 ->> 'doc_type' <> 'cash_adjustment' then
    raise exception 'E_VALIDATION:حركة النقدية لا تطابق التسوية';
  end if;
  perform ingest_insert('cash_adjustments', adj, p_company, p_device);
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;


create or replace function ingest_shift_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur shifts;
  sid uuid := (p_rec ->> 'id')::uuid;
  expected bigint;
  counted bigint;
  diff bigint;
  limit_v bigint;
  e jsonb;
begin
  select * into cur from shifts where id = sid;
  if not found then
    if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-SHF-%' then
      raise exception 'E_VALIDATION:رقم الوردية لا يخص الجهاز';
    end if;
    if p_rec ->> 'status' <> 'open' then
      raise exception 'E_VALIDATION:وردية لم تُفتح';
    end if;
    perform ingest_insert('shifts', p_rec - 'counted_total' - 'counted_breakdown' - 'expected_total' - 'variance' - 'closed_at' - 'close_note' - 'approved_by', p_company, p_device);
    return;
  end if;
  if cur.company_id is distinct from p_company or cur.device_id is distinct from p_device then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if p_rec ->> 'status' <> 'closed' then
    return; -- a re-sent opening
  end if;
  if cur.status = 'closed' then
    if cur.counted_total is distinct from (p_rec ->> 'counted_total')::bigint then
      raise exception 'E_VALIDATION:الوردية اتقفلت قبل كده';
    end if;
    return; -- a re-sent close
  end if;
  select cur.opening_float + coalesce(sum(amount), 0) into expected from cash_movements where shift_id = sid and cash_account_id = cur.cash_account_id;
  select coalesce(sum((x ->> 'value')::bigint * (x ->> 'count')::bigint), 0) into counted
    from jsonb_array_elements(coalesce(p_rec -> 'counted_breakdown', '[]')) x;
  if (p_rec ->> 'expected_total')::bigint <> expected or (p_rec ->> 'counted_total')::bigint <> counted then
    raise exception 'E_VALIDATION:حساب الوردية لا يطابق الحركات';
  end if;
  diff := counted - expected;
  if (p_rec ->> 'variance')::bigint <> diff then
    raise exception 'E_VALIDATION:الفرق غير صحيح';
  end if;
  select coalesce((select (s.value #>> '{}')::bigint from settings s where s.company_id = p_company and s.key = 'shift.varianceAbove' and s.deleted_at is null), 2000) into limit_v;
  if abs(diff) > limit_v
     and (coalesce(p_rec ->> 'close_note', '') = ''
          or not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'shiftVarianceApprove') = 'yes' and a.company_id = p_company and a.active)) then
    raise exception 'E_FORBIDDEN:الفرق محتاج موافقة المدير وتعليق';
  end if;
  update shifts set closed_at = (p_rec ->> 'closed_at')::timestamptz, counted_total = counted, counted_breakdown = p_rec -> 'counted_breakdown',
         expected_total = expected, variance = diff, close_note = nullif(p_rec ->> 'close_note', ''),
         approved_by = nullif(p_rec ->> 'approved_by', '')::uuid, status = 'closed', version = version + 1, updated_at = now()
   where id = sid;
end $$;


create or replace function ingest_row(p_device devices, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  st sync_tables;
  rec jsonb := p_row -> 'record';
  w workers;
  actor uuid := coalesce((p_row ->> 'worker_id')::uuid, (rec ->> 'created_by')::uuid);
begin
  select * into st from sync_tables where table_name = p_row ->> 'table' and push_action is not null;
  if not found or p_row ->> 'op' is distinct from 'upsert' or jsonb_typeof(rec) <> 'object' or rec ->> 'id' is null then
    raise exception 'E_VALIDATION:جدول غير مسموح';
  end if;
  select * into w from workers
   where id = actor and company_id = p_device.company_id and active and deleted_at is null;
  if not found then
    raise exception 'E_FORBIDDEN:عامل غير معروف';
  end if;
  if w.role = 'manager' and p_device.max_role <> 'manager' then
    raise exception 'E_FORBIDDEN:الجهاز لا يسمح بهذا الدور';
  end if;
  if st.push_action <> 'any' and worker_can(w.id, st.push_action) = 'no' then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if st.table_name = 'customers' and worker_can(w.id, 'addCustomerFull') <> 'yes' then
    if exists (select 1 from customers where id = (rec ->> 'id')::uuid)
       or coalesce((rec ->> 'credit_limit')::bigint, 0) <> 0
       or coalesce((rec ->> 'default_discount_bp')::int, 0) <> 0
       or coalesce(rec ->> 'price_list', 'retail') <> 'retail' then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
  if st.table_name = 'sales_returns' then
    perform ingest_sales_return_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'voids' then
    perform ingest_void_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'customer_receipts' then
    perform ingest_customer_receipt_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'cash_adjustments' then
    perform ingest_cash_adjustment_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'shifts' then
    perform ingest_shift_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'expenses' then
    perform ingest_expense_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'cash_transfers' then
    perform ingest_cash_transfer_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'purchase_invoices' then
    perform ingest_purchase_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'purchase_returns' then
    perform ingest_purchase_return_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'supplier_payments' then
    perform ingest_supplier_payment_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'stock_adjustments' then
    perform ingest_stock_adjustment_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;
