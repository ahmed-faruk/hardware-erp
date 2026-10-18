begin;
select plan(11);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
-- a void of one document: the negation of its cash rows, put inside shift p_shift
create function pg_temp.vd(p_actor uuid, p_number text, p_type text, p_target uuid, p_shift uuid) returns jsonb language sql as $$
  with v as (select gen_random_uuid() vid)
  select jsonb_build_object('seq', 1, 'table', 'voids', 'op', 'upsert', 'worker_id', p_actor, 'record', jsonb_build_object(
    'id', vid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'shift_id', p_shift,
    'target_type', p_type, 'target_id', p_target, 'reason', 'mistake', 'approved_by', p_actor,
    'stock_movements', '[]'::jsonb, 'party_ledger', '[]'::jsonb,
    'cash_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', cash_account_id, 'shift_id', p_shift,
        'amount', -amount, 'method', method, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from cash_movements where doc_id = p_target)))
  from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;

-- fixtures (superuser): an open shift on the safe a13; an expense of 500.00 paid from the safe
insert into shifts (id, company_id, number, cash_account_id, opened_at, opening_float, status, worker_id) values
  ('0190f000-0000-7000-8000-0000000001b1', 'a0000000-0000-7000-8000-000000000001', 'K1-SHF-960001', 'a0000000-0000-7000-8000-000000000a13', now(), 0, 'open', 'a0000000-0000-7000-8000-0000000000d3');
insert into expenses (id, company_id, number, issued_at, category_id, amount, cash_account_id) values
  ('0190f000-0000-7000-8000-0000000001e1', 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-960001', now() - interval '3 days', 'a0000000-0000-7000-8000-000000000e01', 50000, 'a0000000-0000-7000-8000-000000000a13');
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -50000, 'cash', 'expense', '0190f000-0000-7000-8000-0000000001e1', now() - interval '3 days');
-- payroll of worker d1: salary for 2026-09 paid 30 days ago; an old advance before it; a deduction of 2026-09;
-- a new advance of 300.00 and a deduction of 100.00 for 2026-10 after it
insert into payroll_entries (id, company_id, number, issued_at, employee_id, kind, month, amount, cash_account_id, net, carry_out) values
  ('0190f000-0000-7000-8000-0000000001a0', 'a0000000-0000-7000-8000-000000000001', 'K1-ADV-960000', now() - interval '40 days', 'a0000000-0000-7000-8000-0000000000d1', 'advance', '2026-08', 15000, 'a0000000-0000-7000-8000-000000000a13', null, null),
  ('0190f000-0000-7000-8000-0000000001d9', 'a0000000-0000-7000-8000-000000000001', 'K1-DED-960009', now() - interval '35 days', 'a0000000-0000-7000-8000-0000000000d1', 'deduction', '2026-09', 5000, null, null, null),
  ('0190f000-0000-7000-8000-0000000001c9', 'a0000000-0000-7000-8000-000000000001', 'K1-SAL-960009', now() - interval '30 days', 'a0000000-0000-7000-8000-0000000000d1', 'salary', '2026-09', 100000, 'a0000000-0000-7000-8000-000000000a13', 100000, 0),
  ('0190f000-0000-7000-8000-0000000001a1', 'a0000000-0000-7000-8000-000000000001', 'K1-ADV-960001', now() - interval '1 day', 'a0000000-0000-7000-8000-0000000000d1', 'advance', '2026-10', 30000, 'a0000000-0000-7000-8000-000000000a13', null, null),
  ('0190f000-0000-7000-8000-0000000001d1', 'a0000000-0000-7000-8000-000000000001', 'K1-DED-960001', now() - interval '1 day', 'a0000000-0000-7000-8000-0000000000d1', 'deduction', '2026-10', 10000, null, null, null);
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -15000, 'cash', 'payroll', '0190f000-0000-7000-8000-0000000001a0', now() - interval '40 days'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -30000, 'cash', 'payroll', '0190f000-0000-7000-8000-0000000001a1', now() - interval '1 day');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d1', 'K1-VOID-960001', 'expense', '0190f000-0000-7000-8000-0000000001e1', '0190f000-0000-7000-8000-0000000001b1')),
  'E_FORBIDDEN', 'a cashier cannot delete an expense');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960002', 'expense', '0190f000-0000-7000-8000-0000000001e1', null)),
  'E_VALIDATION', 'the money of a deleted expense needs an open shift');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960003', 'expense', '0190f000-0000-7000-8000-0000000001e1', '0190f000-0000-7000-8000-0000000001b1')),
  null, 'the manager deletes the expense; its cash comes back in the open shift');
select is((select status from expenses where id = '0190f000-0000-7000-8000-0000000001e1'), 'voided', 'the expense is voided');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960004', 'expense', '0190f000-0000-7000-8000-0000000001e1', '0190f000-0000-7000-8000-0000000001b1')),
  'E_VALIDATION', 'an expense cannot be deleted twice');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960005', 'payroll_entry', '0190f000-0000-7000-8000-0000000001d1', null)),
  null, 'a deduction of an unpaid month is deleted (no cash)');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960006', 'payroll_entry', '0190f000-0000-7000-8000-0000000001d9', null)),
  'E_VALIDATION', 'a deduction of a paid month cannot be deleted');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960007', 'payroll_entry', '0190f000-0000-7000-8000-0000000001a1', '0190f000-0000-7000-8000-0000000001b1')),
  null, 'a new advance is deleted; its cash comes back in the open shift');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960008', 'payroll_entry', '0190f000-0000-7000-8000-0000000001a0', '0190f000-0000-7000-8000-0000000001b1')),
  'E_VALIDATION', 'an advance a later salary took cannot be deleted');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-960009', 'payroll_entry', '0190f000-0000-7000-8000-0000000001c9', '0190f000-0000-7000-8000-0000000001b1')),
  'E_VALIDATION', 'a salary cannot be deleted');
reset role;
select ok(
  (report_exceptions_core('a0000000-0000-7000-8000-000000000001', (now() at time zone 'Africa/Cairo')::date - 1, (now() at time zone 'Africa/Cairo')::date + 1) -> 'voids')
    @> '[{"target_type": "expense", "target_number": "K1-EXP-960001"}]'::jsonb,
  'the exceptions report names the deleted expense');

select * from finish();
rollback;
