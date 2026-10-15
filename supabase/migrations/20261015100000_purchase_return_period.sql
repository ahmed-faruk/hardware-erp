-- Purchase return period: after N days a worker who may not return alone needs a manager's approval (new action purchaseReturnAfterPeriod).
-- The approving worker is stored on the return (approved_by), like sales returns.

alter table purchase_returns add column approved_by uuid;

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
         ('storekeeper', 'editProductData', 'yes'),
         ('storekeeper', 'purchaseReturnAfterPeriod', 'pin')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

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
  days int;
  inv_issued timestamptz;
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
  if orig_id is not null then
    -- after the purchase return period a worker who may not return alone needs a manager's approval on the document
    select i.issued_at into inv_issued from purchase_invoices i where i.id = orig_id;
    select coalesce((select (value #>> '{}')::int from settings where company_id = p_company and key = 'return.purchaseDays' and deleted_at is null), 30) into days;
    if worker_can(p_worker.id, 'purchaseReturnAfterPeriod') <> 'yes'
       and (now() at time zone 'Africa/Cairo')::date - (inv_issued at time zone 'Africa/Cairo')::date > days
       and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'purchaseReturnAfterPeriod') = 'yes' and a.company_id = p_company and a.active) then
      raise exception 'E_FORBIDDEN:مرتجع المشتريات بعد المهلة يحتاج موافقة المدير';
    end if;
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
