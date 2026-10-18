begin;
select plan(5);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$
  select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
-- an expense from outside the box: no account, maybe a (wrong) cash row
create function pg_temp.outside(p_number text, p_with_cash boolean, p_source text default 'owner') returns jsonb language sql as $$
  with v as (select gen_random_uuid() eid)
  select jsonb_build_object('seq', 1, 'table', 'expenses', 'op', 'upsert', 'worker_id', 'a0000000-0000-7000-8000-0000000000d1', 'record',
    jsonb_build_object('id', eid, 'number', p_number, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d1',
      'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'category_id', 'a0000000-0000-7000-8000-000000000e02', 'amount', 700,
      'source', p_source, 'cash_account_id', null,
      'cash_movements', case when p_with_cash then jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
        'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -700, 'method', 'cash', 'doc_type', 'expense', 'doc_id', eid, 'occurred_at', now())) else '[]'::jsonb end))
  from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.outside('K1-EXP-920001', false)), null, 'a cashier records an expense from outside the box');
select is((select source || ':' || coalesce(cash_account_id::text, 'none') from expenses where number = 'K1-EXP-920001'), 'owner:none', 'it is stored as source owner with no account');
select is((select count(*)::int from cash_movements m join expenses e on e.id = m.doc_id where e.number = 'K1-EXP-920001'), 0, 'and no cash movement');
select is(pg_temp.push(pg_temp.outside('K1-EXP-920002', true)), 'E_VALIDATION', 'an outside expense with a cash movement is refused');
select is(pg_temp.push(pg_temp.outside('K1-EXP-920003', false, 'bank')), 'E_VALIDATION', 'an unknown source is refused');

select * from finish();
rollback;
