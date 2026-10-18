begin;
select plan(7);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;
-- one shop box: the safe a13
create function pg_temp.shift_row(p_id uuid, p_number text, p_float bigint, p_status text default 'open', p_counted jsonb default null, p_expected bigint default null, p_variance bigint default null) returns jsonb language sql as $$
  select pg_temp.row_of('shifts', 'a0000000-0000-7000-8000-0000000000d3', jsonb_build_object(
    'id', p_id, 'number', p_number, 'worker_id', 'a0000000-0000-7000-8000-0000000000d3', 'created_by', 'a0000000-0000-7000-8000-0000000000d3',
    'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'opened_at', now(), 'opening_float', p_float, 'status', p_status,
    'counted_breakdown', p_counted, 'counted_total', (select sum((x ->> 'value')::bigint * (x ->> 'count')::bigint) from jsonb_array_elements(p_counted) x),
    'expected_total', p_expected, 'variance', p_variance, 'closed_at', case when p_status = 'closed' then now() end));
$$;
create function pg_temp.push(p_device uuid, p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch(p_device, '0', jsonb_build_array(p_row)));
$$;
create function pg_temp.expense(p_number text, amount bigint) returns jsonb language sql as $$
  with v as (select gen_random_uuid() eid)
  select pg_temp.row_of('expenses', 'a0000000-0000-7000-8000-0000000000d1', jsonb_build_object('id', eid, 'number', p_number, 'issued_at', now(),
    'worker_id', 'a0000000-0000-7000-8000-0000000000d1', 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
    'category_id', 'a0000000-0000-7000-8000-000000000e02', 'amount', amount, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13',
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13',
      'amount', -amount, 'method', 'cash', 'doc_type', 'expense', 'doc_id', eid, 'occurred_at', now())))) from v;
$$;

-- device K1 opens the shop's only shift (float 100.00)
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f1', pg_temp.shift_row('0190f000-0000-7000-8000-000000000b01', 'K1-SHF-970001', 10000)), null, 'device K1 opens the shift');
reset role;
-- a cash purchase of 40.00 and a cash sale of 15.00 happened on the box while it was open (any device)
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -4000, 'cash', 'purchase_invoice', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', 1500, 'cash', 'sales_invoice', gen_random_uuid(), now());

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e2');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f2', pg_temp.shift_row('0190f000-0000-7000-8000-000000000b02', 'K2-SHF-970001', 5000)), 'E_VALIDATION', 'a second open shift for the shop is refused');
-- device K2 closes the shift that K1 opened: expected = 100.00 - 40.00 + 15.00 = 75.00 (count 1x50 + 1x20 + 1x5)
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f2', pg_temp.shift_row('0190f000-0000-7000-8000-000000000b01', 'K1-SHF-970001', 10000, 'closed',
  '[{"value":5000,"count":1},{"value":2000,"count":1},{"value":500,"count":1}]', 6000, 1500)), 'E_VALIDATION', 'a wrong expected amount is refused');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f2', pg_temp.shift_row('0190f000-0000-7000-8000-000000000b01', 'K1-SHF-970001', 10000, 'closed',
  '[{"value":5000,"count":1},{"value":2000,"count":1},{"value":500,"count":1}]', 7500, 0)), null, 'another device closes it, the purchase and the sale counted');
reset role;
select is((select status || ':' || variance from shifts where id = '0190f000-0000-7000-8000-000000000b01'), 'closed:0', 'the shift is closed with variance 0');
-- the box takes an expense from a cashier device, and a new shift can open again
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f1', pg_temp.expense('K1-EXP-970001', 300)), null, 'a cashier pays an expense from the shop box');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e2');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000f2', pg_temp.shift_row('0190f000-0000-7000-8000-000000000b03', 'K2-SHF-970002', 7500)), null, 'after the close another shift can open');

select * from finish();
rollback;
