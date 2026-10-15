-- Purchase screen: the storekeeper may add a product (addProduct, default yes), a worker with addSupplier may add a supplier
-- (not edit one). Products and suppliers are checked here on top of their push action.

update sync_tables set push_action = 'addSupplier' where table_name = 'suppliers';

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
         ('storekeeper', 'purchaseReturnAfterPeriod', 'pin'),
         ('storekeeper', 'purchaseReturnWithoutInvoice', 'yes'),
         ('storekeeper', 'addProduct', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

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
  if st.table_name = 'products' then
    if rec ->> 'deleted_at' is not null and product_in_use(p_device.company_id, (rec ->> 'id')::uuid) then
      -- a product with history is archived, not deleted: only with archiveProduct and only at stock 0
      if worker_can(w.id, 'archiveProduct') <> 'yes' then
        raise exception 'E_FORBIDDEN:أرشفة صنف عليه حركة للمدير';
      end if;
      if coalesce((product_usage_core(p_device.company_id, (rec ->> 'id')::uuid) ->> 'stock_milli')::bigint, 0) <> 0 then
        raise exception 'E_IN_USE:الصنف عليه رصيد، اعمل تسوية الأول';
      end if;
    elsif rec ->> 'deleted_at' is null
          and exists (select 1 from products x where x.id = (rec ->> 'id')::uuid and x.company_id = p_device.company_id and x.deleted_at is not null)
          and product_in_use(p_device.company_id, (rec ->> 'id')::uuid)
          and worker_can(w.id, 'archiveProduct') <> 'yes' then
      raise exception 'E_FORBIDDEN:استرجاع صنف عليه حركة للمدير';
    end if;
  end if;
  if st.table_name = 'customers' and worker_can(w.id, 'addCustomerFull') <> 'yes' then
    if exists (select 1 from customers where id = (rec ->> 'id')::uuid)
       or coalesce((rec ->> 'credit_limit')::bigint, 0) <> 0
       or coalesce((rec ->> 'default_discount_bp')::int, 0) <> 0
       or coalesce(rec ->> 'price_list', 'retail') <> 'retail' then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
  -- a NEW product needs addProduct; a worker without the full supplier right (settings) may only create a supplier, not change one
  if st.table_name = 'products' and not exists (select 1 from products x where x.id = (rec ->> 'id')::uuid)
     and worker_can(w.id, 'addProduct') <> 'yes' then
    raise exception 'E_FORBIDDEN:مينفعش تضيف صنف';
  end if;
  if st.table_name = 'suppliers' and worker_can(w.id, 'settings') <> 'yes'
     and exists (select 1 from suppliers x where x.id = (rec ->> 'id')::uuid) then
    raise exception 'E_FORBIDDEN:تعديل المورد للمدير';
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
