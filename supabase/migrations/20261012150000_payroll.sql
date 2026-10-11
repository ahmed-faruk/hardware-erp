-- Payroll: a fixed monthly salary per worker, advances (cash leaves an account when taken), deductions, and a salary payment that
-- subtracts every advance and deduction by itself; what the salary cannot cover carries to the next month.
-- Only manager devices receive payroll data and salaries (pull 'manager', cost column on workers).

alter table workers add column monthly_salary bigint check (monthly_salary >= 0);
update sync_tables set cost_columns = '{monthly_salary}' where table_name = 'workers';

create table payroll_entries (
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
  employee_id uuid not null references workers (id),
  kind text not null check (kind in ('advance', 'deduction', 'salary')),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount bigint not null check (amount >= 0),
  cash_account_id uuid references cash_accounts (id),
  gross bigint,
  deductions_total bigint,
  advances_total bigint,
  carry_in bigint,
  net bigint,
  carry_out bigint,
  unique (company_id, number)
);
create unique index payroll_one_salary_per_month on payroll_entries (company_id, employee_id, month) where kind = 'salary' and status = 'posted' and deleted_at is null;
create index payroll_employee_idx on payroll_entries (employee_id, issued_at);
create trigger payroll_entries_seq before insert or update on payroll_entries for each row execute function bump_server_seq();
create index payroll_entries_company_seq_idx on payroll_entries (company_id, server_seq);
alter table payroll_entries enable row level security;
revoke all on payroll_entries from anon, authenticated;
grant select on payroll_entries to authenticated;
create policy select_own_company_manager on payroll_entries for select to authenticated using (company_id = current_company() and is_manager_device());

insert into sync_tables (table_name, kind, push_action, pull, cost_columns) values ('payroll_entries', 'document', 'managePayroll', 'manager', '{}');

create or replace function ingest_payroll_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ent jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  eid uuid := (p_rec ->> 'id')::uuid;
  k text := p_rec ->> 'kind';
  emp workers;
  amount bigint := (p_rec ->> 'amount')::bigint;
  mth text := p_rec ->> 'month';
  dev_prefix text := (select prefix from devices where id = p_device);
  last_salary payroll_entries;
  gross bigint;
  ded bigint;
  adv bigint;
  carry_in bigint;
  net bigint;
  carry_out bigint;
  need_cash boolean;
  e jsonb;
begin
  if k not in ('advance', 'deduction', 'salary') then
    raise exception 'E_VALIDATION:نوع غير صالح';
  end if;
  if (p_rec ->> 'number') not like dev_prefix || '-' || (case k when 'advance' then 'ADV' when 'deduction' then 'DED' else 'SAL' end) || '-%' then
    raise exception 'E_VALIDATION:رقم السند لا يخص الجهاز';
  end if;
  select * into emp from workers where id = (p_rec ->> 'employee_id')::uuid and company_id = p_company;
  if not found then
    raise exception 'E_VALIDATION:عامل غير موجود';
  end if;
  if mth is null or mth !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'E_VALIDATION:شهر غير صالح';
  end if;
  if k in ('advance', 'deduction') and amount <= 0 then
    raise exception 'E_VALIDATION:المبلغ لازم يكون أكبر من صفر';
  end if;
  if k = 'deduction' and exists (select 1 from payroll_entries x where x.employee_id = emp.id and x.month = mth and x.kind = 'salary' and x.status = 'posted' and x.deleted_at is null) then
    raise exception 'E_VALIDATION:الشهر ده اتصرف مرتبه';
  end if;

  if k = 'salary' then
    if exists (select 1 from payroll_entries x where x.employee_id = emp.id and x.month = mth and x.kind = 'salary' and x.status = 'posted' and x.deleted_at is null) then
      raise exception 'E_VALIDATION:المرتب اتصرف قبل كده للشهر ده';
    end if;
    if emp.monthly_salary is null then
      raise exception 'E_VALIDATION:العامل ملوش مرتب شهري';
    end if;
    select * into last_salary from payroll_entries x
     where x.employee_id = emp.id and x.kind = 'salary' and x.status = 'posted' and x.deleted_at is null order by x.issued_at desc limit 1;
    gross := emp.monthly_salary;
    select coalesce(sum(x.amount), 0) into ded from payroll_entries x
     where x.employee_id = emp.id and x.kind = 'deduction' and x.month = mth and x.status = 'posted' and x.deleted_at is null;
    select coalesce(sum(x.amount), 0) into adv from payroll_entries x
     where x.employee_id = emp.id and x.kind = 'advance' and x.status = 'posted' and x.deleted_at is null
       and (last_salary.id is null or x.issued_at > last_salary.issued_at);
    carry_in := coalesce(last_salary.carry_out, 0);
    net := greatest(0, gross - ded - adv - carry_in);
    carry_out := greatest(0, ded + adv + carry_in - gross);
    if (p_rec ->> 'gross')::bigint is distinct from gross or (p_rec ->> 'deductions_total')::bigint is distinct from ded
       or (p_rec ->> 'advances_total')::bigint is distinct from adv or (p_rec ->> 'carry_in')::bigint is distinct from carry_in
       or (p_rec ->> 'net')::bigint is distinct from net or (p_rec ->> 'carry_out')::bigint is distinct from carry_out or amount <> net then
      raise exception 'E_VALIDATION:المرتب لا يطابق الحساب';
    end if;
  end if;

  need_cash := k = 'advance' or (k = 'salary' and amount > 0);
  if need_cash then
    if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> -amount
       or (cmov -> 0 ->> 'cash_account_id')::uuid is distinct from (p_rec ->> 'cash_account_id')::uuid
       or not exists (select 1 from cash_accounts a where a.id = (cmov -> 0 ->> 'cash_account_id')::uuid and a.company_id = p_company and a.kind <> 'drawer') then
      raise exception 'E_VALIDATION:حركة النقدية لا تطابق السند';
    end if;
  elsif jsonb_array_length(cmov) <> 0 then
    raise exception 'E_VALIDATION:السند ده مالوش حركة نقدية';
  end if;
  for e in select * from jsonb_array_elements(cmov) loop
    if e ->> 'doc_id' is distinct from eid::text or e ->> 'doc_type' <> 'payroll' then
      raise exception 'E_VALIDATION:حركة لا تخص السند';
    end if;
  end loop;

  perform ingest_insert('payroll_entries', ent, p_company, p_device);
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

-- The payroll report: entries of the period, and per worker what was advanced, deducted and paid.
create or replace function report_payroll_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with en as (
    select p.*, coalesce(w.name, '') employee
      from payroll_entries p left join workers w on w.id = p.employee_id
     where p.company_id = p_company and p.status = 'posted' and p.deleted_at is null
       and (p.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), per as (
    select employee_id, employee,
           coalesce(sum(amount) filter (where kind = 'advance'), 0)::bigint advances,
           coalesce(sum(amount) filter (where kind = 'deduction'), 0)::bigint deductions,
           coalesce(sum(gross) filter (where kind = 'salary'), 0)::bigint salary,
           coalesce(sum(net) filter (where kind = 'salary'), 0)::bigint net_paid,
           (array_agg(carry_out order by issued_at desc) filter (where kind = 'salary'))[1] carry_out,
           count(*)::int entries
      from en group by employee_id, employee
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object('advances', coalesce((select sum(advances) from per), 0), 'deductions', coalesce((select sum(deductions) from per), 0),
        'salary', coalesce((select sum(salary) from per), 0), 'net_paid', coalesce((select sum(net_paid) from per), 0), 'entries', coalesce((select sum(entries) from per), 0)),
    'by_worker', coalesce((select jsonb_agg(jsonb_build_object('employee', employee, 'advances', advances, 'deductions', deductions, 'salary', salary,
        'net_paid', net_paid, 'carry_out', coalesce(carry_out, 0), 'entries', entries) order by employee) from per), '[]'),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'at', issued_at, 'employee', employee, 'kind', kind, 'month', month,
        'amount', amount, 'net', net, 'carry_out', carry_out, 'note', notes) order by issued_at desc, number)
        from (select * from en order by issued_at desc, number limit 1000) y), '[]')
  )
$$;

create or replace function report_payroll(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_payroll_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;

-- the expenses report also shows net salaries paid (advances are not expenses: they come back out of the salary)
alter function report_expenses_core(uuid, date, date) rename to report_expenses_base_core;
create function report_expenses_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select report_expenses_base_core(p_company, p_from, p_to) || jsonb_build_object('payroll', jsonb_build_object(
    'count', (select count(*) from payroll_entries p where p.company_id = p_company and p.kind = 'salary' and p.status = 'posted' and p.deleted_at is null
              and p.amount > 0 and (p.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'amount', coalesce((select sum(p.amount) from payroll_entries p where p.company_id = p_company and p.kind = 'salary' and p.status = 'posted' and p.deleted_at is null
              and (p.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to), 0)))
$$;

revoke all on function report_payroll_core(uuid, date, date), report_expenses_base_core(uuid, date, date), report_expenses_core(uuid, date, date) from public, anon, authenticated;
revoke all on function report_payroll(date, date) from public, anon;
grant execute on function report_payroll(date, date) to authenticated;
revoke execute on function ingest_payroll_bundle(jsonb, uuid, uuid, workers) from public, anon, authenticated;
