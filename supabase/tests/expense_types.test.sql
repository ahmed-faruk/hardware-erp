begin;
select plan(10);

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
create function pg_temp.expense(p_number text, cat uuid) returns jsonb language sql as $$
  with v as (select gen_random_uuid() eid)
  select pg_temp.row_of('expenses', 'a0000000-0000-7000-8000-0000000000d3', jsonb_build_object('id', eid, 'number', p_number, 'issued_at', now(),
    'worker_id', 'a0000000-0000-7000-8000-0000000000d3', 'created_by', 'a0000000-0000-7000-8000-0000000000d3',
    'category_id', cat, 'amount', 500, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13',
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3',
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -500, 'method', 'cash', 'doc_type', 'expense', 'doc_id', eid, 'occurred_at', now())))) from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;

-- old types, like the ones the owner made by hand
insert into expense_categories (id, company_id, name) values
  ('a0000000-0000-7000-8000-0000000008b1', 'a0000000-0000-7000-8000-000000000001', 'كهرباء'),
  ('a0000000-0000-7000-8000-0000000008b2', 'a0000000-0000-7000-8000-000000000001', 'نثريات');
insert into expenses (id, company_id, number, issued_at, category_id, amount, cash_account_id, is_legacy, status) values
  ('a0000000-0000-7000-8000-0000000008c1', 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-910001', '2026-10-02 10:00:00+00', 'a0000000-0000-7000-8000-0000000008b1', 2500, 'a0000000-0000-7000-8000-000000000a13', false, 'posted');
-- the shop type is created by the function when it is missing
delete from expense_categories where name = 'مصروفات محل';

select apply_expense_types();

select is((select count(*)::int from expense_categories where company_id = 'a0000000-0000-7000-8000-000000000001' and deleted_at is null), 1, 'B1 exactly one type is active');
select is((select string_agg(name, ',' order by name) from expense_categories where company_id = 'a0000000-0000-7000-8000-000000000001' and deleted_at is null), 'مصروفات محل', 'B1 it is مصروفات محل');
select ok((select deleted_at is not null from expense_categories where id = 'a0000000-0000-7000-8000-000000000e01'), '«مشتريات» is retired (owner decision 2026-10-19)');
select ok((select deleted_at is not null from expense_categories where id = 'a0000000-0000-7000-8000-0000000008b1'), 'the old types are retired');
select ok((select updated_at > now() - interval '1 minute' and version = 2 from expense_categories where id = 'a0000000-0000-7000-8000-0000000008b1'), 'retiring bumps updated_at and version so devices pull it');
select is((select count(*)::int from expense_categories where company_id = 'b0000000-0000-7000-8000-000000000001' and deleted_at is null), 1, 'another company gets its own one type');
select is((report_expenses_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-31') -> 'by_category' -> 0 ->> 'category'), 'كهرباء', 'B7 the old expense still shows its retired type name in the report');
select is((select push_action from sync_tables where table_name = 'expense_categories'), null, 'B8 devices can no longer push expense types');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.expense('K1-EXP-910002', 'a0000000-0000-7000-8000-0000000008b2')), 'E_VALIDATION', 'B3 a new expense on a retired type is refused');
select is(pg_temp.push(pg_temp.expense('K1-EXP-910003', 'a0000000-0000-7000-8000-000000000e01')), 'E_VALIDATION', 'a new expense on «مشتريات» is refused');

select * from finish();
rollback;
