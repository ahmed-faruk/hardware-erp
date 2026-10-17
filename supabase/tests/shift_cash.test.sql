begin;
select plan(16);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$
  select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;

-- the cashier worker (d1) and the manager (d3) both work on device K1
create function pg_temp.shift_row(p_id uuid, p_number text, p_float bigint, p_status text default 'open', p_counted jsonb default null, p_expected bigint default null, p_variance bigint default null, p_approved uuid default null, p_note text default null) returns jsonb language sql as $$
  select pg_temp.row_of('shifts', 'a0000000-0000-7000-8000-0000000000d1', jsonb_build_object(
    'id', p_id, 'number', p_number, 'worker_id', 'a0000000-0000-7000-8000-0000000000d1', 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
    'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'opened_at', now(), 'opening_float', p_float, 'status', p_status,
    'counted_breakdown', p_counted, 'counted_total', (select sum((x ->> 'value')::bigint * (x ->> 'count')::bigint) from jsonb_array_elements(p_counted) x),
    'expected_total', p_expected, 'variance', p_variance, 'closed_at', case when p_status = 'closed' then now() end, 'approved_by', p_approved, 'close_note', p_note));
$$;
create function pg_temp.expense(p_number text, p_shift uuid, amount bigint, acct uuid default 'a0000000-0000-7000-8000-000000000a11', cat uuid default 'a0000000-0000-7000-8000-000000000e01') returns jsonb language sql as $$
  with v as (select gen_random_uuid() eid)
  select pg_temp.row_of('expenses', 'a0000000-0000-7000-8000-0000000000d1', jsonb_build_object('id', eid, 'number', p_number, 'issued_at', now(),
    'worker_id', 'a0000000-0000-7000-8000-0000000000d1', 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'shift_id', p_shift,
    'category_id', cat, 'amount', amount, 'cash_account_id', acct,
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'cash_account_id', acct, 'shift_id', p_shift,
      'amount', -amount, 'method', 'cash', 'doc_type', 'expense', 'doc_id', eid, 'occurred_at', now())))) from v;
$$;
create function pg_temp.transfer(p_number text, p_shift uuid, amount bigint, dst uuid default 'a0000000-0000-7000-8000-000000000a13', back bigint default null) returns jsonb language sql as $$
  with v as (select gen_random_uuid() tid)
  select pg_temp.row_of('cash_transfers', 'a0000000-0000-7000-8000-0000000000d1', jsonb_build_object('id', tid, 'number', p_number, 'issued_at', now(),
    'worker_id', 'a0000000-0000-7000-8000-0000000000d1', 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'shift_id', p_shift,
    'from_account_id', 'a0000000-0000-7000-8000-000000000a11', 'to_account_id', dst, 'amount', amount,
    'cash_movements', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'shift_id', p_shift, 'amount', -amount, 'method', 'cash', 'doc_type', 'cash_transfer', 'doc_id', tid, 'occurred_at', now()),
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'cash_account_id', dst, 'shift_id', p_shift, 'amount', coalesce(back, amount), 'method', 'cash', 'doc_type', 'cash_transfer', 'doc_id', tid, 'occurred_at', now())))) from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
-- shift 1: float 100.00, an expense of 5.00 and a transfer of 20.00 -> drawer should hold 75.00
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a01', 'K1-SHF-000001', 10000)), null, 'a shift opens');
select is(pg_temp.push(pg_temp.expense('K1-EXP-000001', '0190f000-0000-7000-8000-000000000a01', 500)), null, 'a cashier records an expense from his drawer');
select is(pg_temp.push(pg_temp.expense('K1-EXP-000002', '0190f000-0000-7000-8000-000000000a01', 500, 'a0000000-0000-7000-8000-000000000a13')), null, 'the safe is the shop box: a cashier may pay an expense from it');
select is(pg_temp.push(pg_temp.expense('K1-EXP-000003', '0190f000-0000-7000-8000-000000000a01', 500, 'a0000000-0000-7000-8000-000000000a11', 'a0000000-0000-7000-8000-000000000999')), 'E_VALIDATION', 'an unknown category is refused');
select is(pg_temp.push(pg_temp.transfer('K1-XFR-000001', '0190f000-0000-7000-8000-000000000a01', 2000)), null, 'a cashier moves drawer cash to the safe');
select is(pg_temp.push(pg_temp.transfer('K1-XFR-000002', '0190f000-0000-7000-8000-000000000a01', 2000, 'a0000000-0000-7000-8000-000000000a12')), 'E_FORBIDDEN', 'but only to the safe');
select is(pg_temp.push(pg_temp.transfer('K1-XFR-000003', '0190f000-0000-7000-8000-000000000a01', 2000, 'a0000000-0000-7000-8000-000000000a13', 1000)), 'E_VALIDATION', 'a transfer whose rows do not cancel out is refused');

-- close with the right count: 75.00 = 1x50 + 1x20 + 1x5
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a01', 'K1-SHF-000001', 10000, 'closed',
  '[{"value":5000,"count":1},{"value":2000,"count":1},{"value":500,"count":1}]', 7500, 0)), null, 'a correct blind close is accepted');
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a01', 'K1-SHF-000001', 10000, 'closed',
  '[{"value":5000,"count":1},{"value":2000,"count":1},{"value":500,"count":1}]', 7500, 0)), null, 'the same close sent again is harmless');
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a01', 'K1-SHF-000001', 10000, 'closed',
  '[{"value":5000,"count":2}]', 7500, 2500)), 'E_VALIDATION', 'a different close of a closed shift is refused');
reset role;
select is((select status || ':' || variance from shifts where id = '0190f000-0000-7000-8000-000000000a01'), 'closed:0', 'the shift is closed with variance 0');
-- everything of shift 1 happened earlier (in this test it all shares one transaction time)
update cash_movements set occurred_at = now() - interval '2 hours' where doc_type in ('expense', 'cash_transfer');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
-- shift 2: float 50.00, nothing happens; counted 20.00 -> shortage of 30.00 > 20.00 limit
select pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a02', 'K1-SHF-000002', 5000));
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a02', 'K1-SHF-000002', 5000, 'closed', '[{"value":2000,"count":1}]', 5000, -3000)), 'E_FORBIDDEN', 'a shortage above the limit needs the manager');
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a02', 'K1-SHF-000002', 5000, 'closed', '[{"value":2000,"count":1}]', 5000, -3000, 'a0000000-0000-7000-8000-0000000000d3')), 'E_FORBIDDEN', 'an approval without a note is not enough');
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a02', 'K1-SHF-000002', 5000, 'closed', '[{"value":2000,"count":1}]', 4000, -2000)), 'E_VALIDATION', 'an expected amount that does not match the movements is refused');
select is(pg_temp.push(pg_temp.shift_row('0190f000-0000-7000-8000-000000000a02', 'K1-SHF-000002', 5000, 'closed', '[{"value":2000,"count":1}]', 5000, -3000, 'a0000000-0000-7000-8000-0000000000d3', 'نقص')), null, 'with the manager and a note it is accepted');
reset role;
select is((select approved_by::text from shifts where id = '0190f000-0000-7000-8000-000000000a02'), 'a0000000-0000-7000-8000-0000000000d3', 'the approver is stored');

select * from finish();
rollback;
