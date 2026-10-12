-- Deleting a product (manager): allowed only when it never moved. The server counts everything that touches it.

create function product_usage_core(p_company uuid, p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select id, legacy_item_id from products where id = p_product and company_id = p_company)
  select jsonb_build_object(
    'sales', (select count(*) from sales_invoice_lines l where l.product_id = p.id and l.company_id = p_company),
    'sales_returns', (select count(*) from sales_return_lines l where l.product_id = p.id and l.company_id = p_company),
    'purchases', (select count(*) from purchase_invoice_lines l where l.product_id = p.id and l.company_id = p_company),
    'purchase_returns', (select count(*) from purchase_return_lines l where l.product_id = p.id and l.company_id = p_company),
    'movements', (select count(*) from stock_movements m where m.product_id = p.id and m.company_id = p_company),
    'adjustments', (select count(*) from stock_adjustment_lines l where l.product_id = p.id and l.company_id = p_company),
    'legacy_sales', case when p.legacy_item_id is null then 0 else
        (select count(*) from legacy_sale_lines l join legacy_sales h on h.id = l.sale_id
          where h.company_id = p_company and l.product_id = p.legacy_item_id) end,
    'legacy_purchases', case when p.legacy_item_id is null then 0 else
        (select count(*) from legacy_purchase_lines l join legacy_purchases h on h.id = l.purchase_id
          where h.company_id = p_company and l.product_id = p.legacy_item_id) end,
    'stock_milli', coalesce((select sum(m.qty) from stock_movements m where m.product_id = p.id and m.company_id = p_company), 0)
  ) from p
$$;

create function product_in_use(p_company uuid, p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (v ->> 'sales')::int + (v ->> 'sales_returns')::int + (v ->> 'purchases')::int
                          + (v ->> 'purchase_returns')::int + (v ->> 'movements')::int + (v ->> 'adjustments')::int
                          + (v ->> 'legacy_sales')::int + (v ->> 'legacy_purchases')::int > 0
                          or (v ->> 'stock_milli')::bigint <> 0
                     from (select product_usage_core(p_company, p_product) v) x), false)
$$;

revoke all on function product_usage_core(uuid, uuid), product_in_use(uuid, uuid) from public, anon, authenticated;

-- the manager's device asks before offering the delete (needs the internet: the old history lives only here)
create function product_usage(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  v := product_usage_core(current_company(), p_product_id);
  if v is null then
    raise exception 'E_VALIDATION:صنف غير موجود';
  end if;
  return jsonb_build_object('ok', true, 'data', v);
end $$;
grant execute on function product_usage(uuid) to authenticated;

-- copy of the latest ingest_row with one more check: a delete of a product in use is refused (E_IN_USE)
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
  -- a product with any movement, history or stock cannot be deleted
  if st.table_name = 'products' and rec ->> 'deleted_at' is not null
     and product_in_use(p_device.company_id, (rec ->> 'id')::uuid) then
    raise exception 'E_IN_USE:الصنف عليه حركة ومينفعش يتحذف';
  end if;
  if st.table_name = 'customers' and worker_can(w.id, 'addCustomerFull') <> 'yes' then
    if exists (select 1 from customers where id = (rec ->> 'id')::uuid)
       or coalesce((rec ->> 'credit_limit')::bigint, 0) <> 0
       or coalesce((rec ->> 'default_discount_bp')::int, 0) <> 0
       or coalesce(rec ->> 'price_list', 'retail') <> 'retail' then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
  -- paying a purchase or a supplier from the owner's pocket needs its own permission
  if st.table_name in ('purchase_invoices', 'supplier_payments') and worker_can(w.id, 'payFromOwner') <> 'yes' then
    if (st.table_name = 'supplier_payments' and rec ->> 'method' = 'owner')
       or (st.table_name = 'purchase_invoices' and exists (select 1 from jsonb_array_elements(coalesce(rec -> 'payments', '[]')) x where x ->> 'method' = 'owner')) then
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
  elsif st.table_name = 'payroll_entries' then
    perform ingest_payroll_bundle(rec, p_device.company_id, p_device.id, w);
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
