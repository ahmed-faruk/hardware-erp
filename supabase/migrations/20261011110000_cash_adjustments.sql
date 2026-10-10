-- FIN-11: no manual edit of a cash balance; a correction is a voucher with a reason, by the manager only.
create table cash_adjustments (
  id uuid primary key,
  company_id uuid not null references companies (id),
  device_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  deleted_at timestamptz,
  server_seq bigint not null default nextval('server_seq'),
  number text not null,
  issued_at timestamptz not null,
  worker_id uuid references workers (id),
  shift_id uuid references shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid,
  notes text,
  is_legacy bool not null default false,
  legacy jsonb,
  cash_account_id uuid not null references cash_accounts (id),
  amount bigint not null check (amount <> 0),
  reason_code text not null check (reason_code in ('count_error', 'old_difference', 'entry_fix', 'other')),
  note text,
  unique (company_id, number)
);
create trigger cash_adjustments_seq before insert or update on cash_adjustments for each row execute function bump_server_seq();
create index cash_adjustments_company_seq_idx on cash_adjustments (company_id, server_seq);
alter table cash_adjustments enable row level security;
revoke all on cash_adjustments from anon, authenticated;
grant select on cash_adjustments to authenticated;
create policy select_own_company on cash_adjustments for select to authenticated using (company_id = current_company());

insert into sync_tables (table_name, kind, push_action, pull, cost_columns) values ('cash_adjustments', 'document', 'cashAdjustment', 'all', '{}');

create or replace function ingest_cash_adjustment_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  adj jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  aid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  e jsonb;
begin
  if p_worker.role <> 'manager' then
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

create or replace function report_audit_extras_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (
    select * from audit_log
     where company_id = p_company and (occurred_at at time zone 'Africa/Cairo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'negative_stock', (select count(*) from a where action = 'negative_stock_sale'),
    'price_overrides', (select count(*) from a where action = 'price_override'),
    'discount_overrides', (select count(*) from a where action = 'discount_over_limit'),
    'pin_failures', (select count(*) from a where action in ('pin_failed', 'pin_locked')),
    'cart_removals', (select count(*) from a where action = 'cart_line_removed'),
    'settings_changes', coalesce((select jsonb_agg(jsonb_build_object('key', a.after ->> 'key', 'at', a.occurred_at, 'worker', coalesce(w.name, '—')) order by a.occurred_at)
      from a left join workers w on w.id = a.worker_id where a.action = 'setting_changed'), '[]'),
    'cash_adjustments', coalesce((select jsonb_agg(jsonb_build_object('number', c.number, 'at', c.issued_at, 'account', coalesce(ca.name, '—'), 'amount', c.amount, 'reason', c.reason_code) order by c.issued_at)
      from cash_adjustments c left join cash_accounts ca on ca.id = c.cash_account_id
     where c.company_id = p_company and (c.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'),
    'clock_warnings', coalesce((select jsonb_agg(jsonb_build_object('device', coalesce(d.name, '—'), 'at', a.occurred_at, 'skew_ms', (a.after ->> 'skewMs')::bigint) order by a.occurred_at)
      from a left join devices d on d.id = a.entity_id where a.action = 'clock_suspicious'), '[]')
  )
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
