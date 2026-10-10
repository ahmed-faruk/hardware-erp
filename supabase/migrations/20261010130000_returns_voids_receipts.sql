-- Returns, voids and customer receipts (phase 7, PR A). Each document arrives as one record with its children embedded.
create or replace function role_can(p_role text, p_action text) returns text
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
         ('cashier', 'addCustomer', 'yes'),
         ('cashier', 'returnAfterPeriod', 'pin'),
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

update sync_tables set push_action = 'returnWithInvoice' where table_name = 'sales_returns';
update sync_tables set push_action = 'void' where table_name = 'voids';
update sync_tables set push_action = 'customerReceipt' where table_name = 'customer_receipts';

-- RET-01..04, RET-06, RET-08
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
  if orig_id is null and p_worker.role <> 'manager' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة للمدير فقط';
  end if;

  if orig_id is not null then
    select * into orig from sales_invoices where id = orig_id and company_id = p_company;
    if not found or orig.status <> 'posted' then
      raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
    end if;
    select coalesce((select (value #>> '{}')::int from settings where company_id = p_company and key = 'return.periodDays' and deleted_at is null), 30) into days;
    if p_worker.role <> 'manager'
       and (now() at time zone 'Africa/Cairo')::date - (orig.issued_at at time zone 'Africa/Cairo')::date > days
       and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and a.role = 'manager' and a.company_id = p_company and a.active) then
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

-- VOID-02: the manager cancels a finished invoice with a reversing document
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
  if p_worker.role <> 'manager' then
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

-- FIN-06: a customer pays on account
create or replace function ingest_customer_receipt_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rc jsonb := p_rec - 'party_ledger' - 'cash_movements';
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  rc_id uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-RCV-%' then
    raise exception 'E_VALIDATION:رقم السند لا يخص الجهاز';
  end if;
  if amount <= 0 or not exists (select 1 from customers c where c.id = (p_rec ->> 'customer_id')::uuid and c.company_id = p_company) then
    raise exception 'E_VALIDATION:تحصيل غير صالح';
  end if;
  if jsonb_array_length(pled) <> 1 or (pled -> 0 ->> 'amount')::bigint <> -amount or (pled -> 0 ->> 'party_id')::uuid <> (p_rec ->> 'customer_id')::uuid then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق التحصيل';
  end if;
  if p_rec ->> 'method' = 'cash' then
    if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> amount
       or not exists (select 1 from cash_accounts a where a.id = (cmov -> 0 ->> 'cash_account_id')::uuid and a.company_id = p_company) then
      raise exception 'E_VALIDATION:حركة الدرج لا تطابق التحصيل';
    end if;
  elsif jsonb_array_length(cmov) <> 0 then
    raise exception 'E_VALIDATION:التحصيل غير النقدي لا يدخل الدرج';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from rc_id::text or e ->> 'doc_type' <> 'customer_receipt' then
      raise exception 'E_VALIDATION:حركة لا تخص التحصيل';
    end if;
  end loop;
  perform ingest_insert('customer_receipts', rc, p_company, p_device);
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
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
  if st.push_action <> 'any' and role_can(w.role, st.push_action) = 'no' then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if st.table_name = 'customers' and w.role <> 'manager' then
    if exists (select 1 from customers where id = (rec ->> 'id')::uuid)
       or coalesce((rec ->> 'credit_limit')::bigint, 0) <> 0
       or coalesce((rec ->> 'default_discount_bp')::int, 0) <> 0 then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
  if st.table_name = 'sales_returns' then
    perform ingest_sales_return_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'voids' then
    perform ingest_void_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'customer_receipts' then
    perform ingest_customer_receipt_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;
