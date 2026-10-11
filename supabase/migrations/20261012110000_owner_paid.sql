-- Purchases and supplier payments can be paid from the owner's pocket ("من خارج الخزنة"): the money never touches a cash account
-- and the shop owes the owner nothing. A purchase payment of method 'owner' just lowers the credit like cash does.

alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash', 'credit', 'card', 'instapay', 'wallet', 'other', 'owner'));

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

-- Purchases report: totals and per supplier, split by where the money came from (safe / owner's pocket / other / credit) plus returns and later payments.
create or replace function report_purchases_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (
    select id, supplier_id, total, is_legacy
      from purchase_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and (issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), pay as (
    select inv.supplier_id,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)::bigint safe,
           coalesce(sum(p.amount) filter (where p.method = 'owner'), 0)::bigint owner,
           coalesce(sum(p.amount) filter (where p.method in ('card', 'instapay', 'wallet', 'other')), 0)::bigint other,
           coalesce(sum(p.amount) filter (where p.method = 'credit'), 0)::bigint credit
      from inv join payments p on p.document_id = inv.id and p.document_type = 'purchase_invoice' and p.company_id = p_company and p.deleted_at is null
     group by inv.supplier_id
  ), tot as (
    select supplier_id, count(*)::int invoices, sum(total)::bigint total from inv group by supplier_id
  ), ret as (
    select supplier_id, sum(total)::bigint returns
      from purchase_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and (issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by supplier_id
  ), later as (
    select supplier_id,
           coalesce(sum(amount) filter (where method = 'owner'), 0)::bigint owner,
           coalesce(sum(amount) filter (where method <> 'owner'), 0)::bigint other
      from supplier_payments
     where company_id = p_company and deleted_at is null
       and (issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by supplier_id
  ), per as (
    select s.id supplier_id, s.name,
           coalesce(tot.invoices, 0) invoices, coalesce(tot.total, 0) total,
           coalesce(pay.safe, 0) safe, coalesce(pay.owner, 0) owner, coalesce(pay.other, 0) other, coalesce(pay.credit, 0) credit,
           coalesce(ret.returns, 0) returns, coalesce(later.owner, 0) later_owner, coalesce(later.other, 0) later_other
      from suppliers s
      left join tot on tot.supplier_id = s.id left join pay on pay.supplier_id = s.id
      left join ret on ret.supplier_id = s.id left join later on later.supplier_id = s.id
     where s.company_id = p_company
       and (tot.supplier_id is not null or ret.supplier_id is not null or later.supplier_id is not null)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object(
      'invoices', coalesce((select sum(invoices) from per), 0), 'total', coalesce((select sum(total) from per), 0),
      'safe', coalesce((select sum(safe) from per), 0), 'owner', coalesce((select sum(owner) from per), 0),
      'other', coalesce((select sum(other) from per), 0), 'credit', coalesce((select sum(credit) from per), 0),
      'returns', coalesce((select sum(returns) from per), 0),
      'later_owner', coalesce((select sum(later_owner) from per), 0), 'later_other', coalesce((select sum(later_other) from per), 0)),
    'by_supplier', coalesce((select jsonb_agg(jsonb_build_object('supplier', name, 'invoices', invoices, 'total', total, 'safe', safe, 'owner', owner,
        'other', other, 'credit', credit, 'returns', returns, 'later_owner', later_owner, 'later_other', later_other) order by total desc, name) from per), '[]'),
    'legacy_invoices', coalesce((select count(*) from inv where is_legacy), 0)
  )
$$;

create or replace function report_purchases(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_purchases_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;

revoke all on function report_purchases_core(uuid, date, date) from public, anon, authenticated;
revoke all on function report_purchases(date, date) from public, anon;
grant execute on function report_purchases(date, date) to authenticated;
