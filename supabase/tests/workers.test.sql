begin;
select plan(5);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.worker_row(p_actor uuid, p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', 'workers', 'op', 'upsert', 'worker_id', p_actor, 'record', jsonb_build_object(
    'id', p_id, 'name', 'New worker', 'role', 'cashier', 'pin_hash', 'hash', 'pin_salt', 'salt', 'active', true, 'created_by', p_actor));
$$;

-- manager worker on a manager device: accepted
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0',
  jsonb_build_array(pg_temp.worker_row('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-0000000000b1'))) -> 'data' -> 'rejected'),
  '[]'::jsonb, 'a manager can add a worker');
-- cashier worker, even on a manager device: refused
select is((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0',
  jsonb_build_array(pg_temp.worker_row('a0000000-0000-7000-8000-0000000000d1', '0190f000-0000-7000-8000-0000000000b2'))) -> 'data' -> 'rejected' -> 0 ->> 'code'),
  'E_FORBIDDEN', 'a cashier cannot add a worker');
reset role;
-- manager worker on a cashier-level device (the phone): refused
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select is((ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0.0.0',
  jsonb_build_array(pg_temp.worker_row('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-0000000000b3'))) -> 'data' -> 'rejected' -> 0 ->> 'code'),
  'E_FORBIDDEN', 'a manager login on a cashier-level device cannot add a worker');
-- the new worker (with its PIN hash) reaches other devices so they can log in offline
select ok(exists (select 1 from jsonb_array_elements(pull_changes(0, 1000) -> 'data' -> 'rows') r
                   where r ->> 'table' = 'workers' and r -> 'record' ->> 'id' = '0190f000-0000-7000-8000-0000000000b1'
                     and r -> 'record' ->> 'pin_hash' = 'hash'), 'the phone receives the new worker with its PIN hash');
reset role;
select is((select count(*)::int from workers where id in ('0190f000-0000-7000-8000-0000000000b2', '0190f000-0000-7000-8000-0000000000b3')), 0,
  'refused rows left nothing behind');

select * from finish();
rollback;
