begin;
select plan(6);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.push(p_worker uuid, p_number text, amount bigint, reason text, note text default null, move bigint default null) returns text language sql as $$
  with v as (select gen_random_uuid() aid)
  select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'cash_adjustments', 'op', 'upsert', 'worker_id', p_worker,
    'record', jsonb_build_object('id', aid, 'number', p_number, 'issued_at', now(), 'worker_id', p_worker, 'created_by', p_worker,
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', amount, 'reason_code', reason, 'note', note,
      'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_worker, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13',
        'amount', coalesce(move, amount), 'method', 'cash', 'doc_type', 'cash_adjustment', 'doc_id', aid, 'occurred_at', now())))))) -> 'data' -> 'rejected' -> 0 ->> 'code' from v;
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-CAJ-000001', -500, 'count_error'), null, 'the manager can adjust the safe');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d1', 'K1-CAJ-000002', -500, 'count_error'), 'E_FORBIDDEN', 'a cashier cannot');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-CAJ-000003', 500, 'other'), 'E_VALIDATION', '"other" needs a note');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-CAJ-000004', 500, 'other', 'found cash'), null, '... and passes with one');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-CAJ-000005', 500, 'entry_fix', null, 400), 'E_VALIDATION', 'a movement that differs from the amount is refused');
reset role;
select is((select sum(amount) from cash_movements where doc_type = 'cash_adjustment')::bigint, 0::bigint, 'the two accepted vouchers (−5.00 and +5.00) net to zero in the safe');

select * from finish();
rollback;
