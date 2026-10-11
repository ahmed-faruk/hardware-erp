begin;
select plan(11);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.adjust(p_worker uuid, p_number text) returns text language sql as $$
  with v as (select gen_random_uuid() aid)
  select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'cash_adjustments', 'op', 'upsert', 'worker_id', p_worker,
    'record', jsonb_build_object('id', aid, 'number', p_number, 'issued_at', now(), 'worker_id', p_worker, 'created_by', p_worker,
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -500, 'reason_code', 'count_error',
      'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_worker, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13',
        'amount', -500, 'method', 'cash', 'doc_type', 'cash_adjustment', 'doc_id', aid, 'occurred_at', now())))))) -> 'data' -> 'rejected' -> 0 ->> 'code' from v;
$$;

-- without a group: the role defaults
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'sell'), 'yes', 'cashier sells by default');
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'void'), 'no', 'cashier cannot void by default');
select is(worker_can('a0000000-0000-7000-8000-0000000000d3', 'void'), 'yes', 'manager can');

-- a group that allows cash adjustments and nothing else
insert into permission_groups (id, company_id, name, permissions)
values ('a0000000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'مجموعة اختبار', '{"cashAdjustment": "yes", "recordExpense": "pin"}');
update workers set group_id = 'a0000000-0000-7000-8000-0000000000b1' where id = 'a0000000-0000-7000-8000-0000000000d1';
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'cashAdjustment'), 'yes', 'the group grants more than the role');
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'recordExpense'), 'pin', 'the group can turn a yes into pin');
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'sell'), 'no', 'with a group an unlisted action is no');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.adjust('a0000000-0000-7000-8000-0000000000d1', 'K1-CAJ-000101'), null, 'the server accepts what the group allows');
reset role;

-- a manager in a group keeps the administration actions, nothing else
update workers set group_id = 'a0000000-0000-7000-8000-0000000000b1' where id = 'a0000000-0000-7000-8000-0000000000d3';
select is(worker_can('a0000000-0000-7000-8000-0000000000d3', 'manageUsers'), 'yes', 'a manager cannot lock himself out');
select is(worker_can('a0000000-0000-7000-8000-0000000000d3', 'sell'), 'no', '... but the group still limits the rest');

-- a deleted group falls back to the role defaults
update permission_groups set deleted_at = now() where id = 'a0000000-0000-7000-8000-0000000000b1';
select is(worker_can('a0000000-0000-7000-8000-0000000000d1', 'sell'), 'yes', 'a deleted group falls back to the role');

select throws_ok(
  $$insert into permission_groups (id, company_id, name, permissions) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'x', '{"sell": "maybe"}')$$,
  '23514', null, 'only yes, pin and no are valid values');

select * from finish();
rollback;
