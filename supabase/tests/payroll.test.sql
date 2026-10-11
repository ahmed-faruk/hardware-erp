begin;
select plan(17);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;

-- d1 = cashier (the employee), d3 = manager; the cashier earns 3000.00 a month
update workers set monthly_salary = 300000 where id = 'a0000000-0000-7000-8000-0000000000d1';

-- one payroll entry as the device would send it
create function pg_temp.entry(p_actor uuid, p_kind text, p_number text, p_month text, p_amount bigint, p_at timestamptz, extra jsonb default '{}', cash bigint default null, account uuid default 'a0000000-0000-7000-8000-000000000a13') returns jsonb language sql as $$
  with v as (select gen_random_uuid() eid)
  select jsonb_build_object('seq', 1, 'table', 'payroll_entries', 'op', 'upsert', 'worker_id', p_actor, 'record',
    jsonb_build_object('id', eid, 'number', p_number, 'issued_at', p_at, 'worker_id', p_actor, 'created_by', p_actor,
      'employee_id', 'a0000000-0000-7000-8000-0000000000d1', 'kind', p_kind, 'month', p_month, 'amount', p_amount,
      'cash_account_id', case when cash is not null then account else null end,
      'cash_movements', case when cash is not null then jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', account,
          'amount', -cash, 'method', 'cash', 'doc_type', 'payroll', 'doc_id', eid, 'occurred_at', p_at)) else '[]'::jsonb end) || extra)
  from v;
$$;
create function pg_temp.push(p jsonb) returns jsonb language sql as $$
  select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p))
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
-- a cashier cannot touch payroll
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d1', 'advance', 'K1-ADV-000001', '2026-10', 50000, '2026-10-05 10:00:00+00', '{}', 50000))), 'E_FORBIDDEN', 'a cashier cannot give an advance');
-- the manager: an advance of 500.00 from the safe
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'advance', 'K1-ADV-000002', '2026-10', 50000, '2026-10-05 10:00:00+00', '{}', 50000))), null, 'the manager gives an advance from the safe');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'advance', 'K1-ADV-000003', '2026-10', 50000, '2026-10-06 10:00:00+00'))), 'E_VALIDATION', 'an advance without its cash movement is refused');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'advance', 'K1-ADV-000004', '2026-10', 50000, '2026-10-06 10:00:00+00', '{}', 50000, 'a0000000-0000-7000-8000-000000000a11'))), 'E_VALIDATION', 'an advance cannot come out of a drawer');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'advance', 'K1-ADV-000005', '2026-10', 0, '2026-10-06 10:00:00+00', '{}', 0))), 'E_VALIDATION', 'a zero advance is refused');
-- a deduction of 100.00: no cash
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'deduction', 'K1-DED-000001', '2026-10', 10000, '2026-10-07 10:00:00+00'))), null, 'a deduction needs no cash');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'deduction', 'K1-DED-000002', '2026-10', 10000, '2026-10-07 11:00:00+00', '{}', 10000))), 'E_VALIDATION', 'a deduction with a cash movement is refused');
-- the salary: 3000 - 500 advance - 100 deduction = 2400 net
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'salary', 'K1-SAL-000001', '2026-10', 230000, '2026-10-31 10:00:00+00',
  '{"gross": 300000, "deductions_total": 10000, "advances_total": 50000, "carry_in": 0, "net": 230000, "carry_out": 0}', 230000))), 'E_VALIDATION', 'a salary that does not match the server''s slip is refused (2300.00 is wrong)');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'salary', 'K1-SAL-000002', '2026-10', 240000, '2026-10-31 10:00:00+00',
  '{"gross": 300000, "deductions_total": 10000, "advances_total": 50000, "carry_in": 0, "net": 240000, "carry_out": 0}', 240000))), null, 'the right slip is accepted: 3000 - 500 - 100 = 2400');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'salary', 'K1-SAL-000003', '2026-10', 240000, '2026-10-31 11:00:00+00',
  '{"gross": 300000, "deductions_total": 10000, "advances_total": 50000, "carry_in": 0, "net": 240000, "carry_out": 0}', 240000))), 'E_VALIDATION', 'one salary per worker per month');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'deduction', 'K1-DED-000003', '2026-10', 1000, '2026-11-01 10:00:00+00'))), 'E_VALIDATION', 'no deduction for a month already paid');
-- November: an advance of 3500.00 is more than the salary: the rest (500.00) carries to December
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'advance', 'K1-ADV-000006', '2026-11', 350000, '2026-11-10 10:00:00+00', '{}', 350000))), null, 'a big advance in November');
select is(pg_temp.code(pg_temp.push(pg_temp.entry('a0000000-0000-7000-8000-0000000000d3', 'salary', 'K1-SAL-000004', '2026-11', 0, '2026-11-30 10:00:00+00',
  '{"gross": 300000, "deductions_total": 0, "advances_total": 350000, "carry_in": 0, "net": 0, "carry_out": 50000}'))), null, 'nothing is paid, 500.00 carries out');
reset role;

select is((select sum(amount) from cash_movements where doc_type = 'payroll')::bigint, -(50000 + 240000 + 350000)::bigint, 'cash left the safe for the advances and the paid salary only');
select is((select carry_out from payroll_entries where number = 'K1-SAL-000004'), 50000::bigint, 'the shortfall is stored as the carry');
select is((select cost_columns from sync_tables where table_name = 'workers'), array['monthly_salary'], 'a salary is a cost column: only manager devices receive it');
select is(report_payroll_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-31') -> 'total' ->> 'net_paid', '240000', 'the report adds what was paid in October');

select * from finish();
rollback;
