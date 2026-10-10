-- Phase 8 PR A: closing a shift (blind count), expenses and cash transfers.
-- Money rows are checked on the server, never trusted from the device.

alter table shifts add column approved_by uuid references workers (id);

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
         ('cashier', 'recordExpense', 'yes'),
         ('cashier', 'cashTransfer', 'yes'),
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

update sync_tables set push_action = 'recordExpense' where table_name = 'expenses';
update sync_tables set push_action = 'cashTransfer' where table_name = 'cash_transfers';
update sync_tables set push_action = 'settings' where table_name = 'expense_categories';

-- FIN-02..03: a shift is pushed twice, open and then closed. The close updates the row exactly once; the server
-- recomputes what the drawer should hold from the shift's own cash movements.
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
          or not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and a.role = 'manager' and a.company_id = p_company and a.active)) then
    raise exception 'E_FORBIDDEN:الفرق محتاج موافقة المدير وتعليق';
  end if;
  update shifts set closed_at = (p_rec ->> 'closed_at')::timestamptz, counted_total = counted, counted_breakdown = p_rec -> 'counted_breakdown',
         expected_total = expected, variance = diff, close_note = nullif(p_rec ->> 'close_note', ''),
         approved_by = nullif(p_rec ->> 'approved_by', '')::uuid, status = 'closed', version = version + 1, updated_at = now()
   where id = sid;
end $$;

-- FIN-07: an expense takes cash out of one account; a cashier may only use the drawer of the device he is on
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
  if p_worker.role <> 'manager' and not (acct.kind = 'drawer' and acct.owner_device_id = p_device) then
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

-- FIN-05: cash moves between two accounts; the two rows cancel out. A cashier only moves his drawer's cash to the safe.
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
  if p_worker.role <> 'manager' and not (src.kind = 'drawer' and src.owner_device_id = p_device and dst.kind = 'safe') then
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
