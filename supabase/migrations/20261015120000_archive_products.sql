-- Archive and restore a product that has history: allowed for the holder of archiveProduct and only at stock 0 (the server
-- re-checks both). A product that never moved is still deleted with editProductData (the previous rule).

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
