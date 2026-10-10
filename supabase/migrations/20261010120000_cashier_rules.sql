-- Cashier rules (phase 6): settings are pushed by managers, cashiers may add customers (limit 0, no discount),
-- and sales from devices below manager level get the product's cost from the server.
update sync_tables set push_action = 'settings' where table_name = 'settings';
update sync_tables set push_action = 'addCustomer' where table_name = 'customers';

-- SQL copy of src/domain/permissions.ts (a unit test keeps them identical): `addCustomer` is new
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
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

create or replace function ingest_sales_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
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
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-INV-%' then
    raise exception 'E_VALIDATION:رقم الفاتورة لا يخص الجهاز';
  end if;
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

  -- devices below manager level never receive costs, so they send 0: the server puts the product's current cost on the
  -- lines and on the stock movements (the owner's rule: cost = purchase price kept on the product)
  if (select max_role from devices where id = p_device) <> 'manager' then
    select coalesce(jsonb_agg(l || jsonb_build_object('unit_cost', coalesce((select pr.unit_cost from products pr
             where pr.id = (l ->> 'product_id')::uuid and pr.company_id = p_company), 0)) order by ord), '[]')
      into lines from jsonb_array_elements(lines) with ordinality t (l, ord);
    select coalesce(jsonb_agg(m || jsonb_build_object('unit_cost', coalesce((select pr.unit_cost from products pr
             where pr.id = (m ->> 'product_id')::uuid and pr.company_id = p_company), 0)) order by ord), '[]')
      into smov from jsonb_array_elements(smov) with ordinality t (m, ord);
  end if;

  perform ingest_insert('sales_invoices', inv, p_company, p_device);
  for e in select * from jsonb_array_elements(lines) loop perform ingest_insert('sales_invoice_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
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
  if st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;
