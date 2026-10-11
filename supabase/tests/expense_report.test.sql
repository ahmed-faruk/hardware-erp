begin;
select plan(7);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

insert into expense_categories (id, company_id, name) values
  ('a0000000-0000-7000-8000-0000000008a1', 'a0000000-0000-7000-8000-000000000001', 'كهرباء تقرير'),
  ('a0000000-0000-7000-8000-0000000008a2', 'a0000000-0000-7000-8000-000000000001', 'نثريات تقرير');
-- Cairo is UTC+3 in October: 22:30 UTC on 30 Sep belongs to 1 Oct
insert into expenses (id, company_id, number, issued_at, category_id, amount, cash_account_id, is_legacy, status) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-900001', '2026-09-30 22:30:00+00', 'a0000000-0000-7000-8000-0000000008a1', 15000, 'a0000000-0000-7000-8000-000000000a13', false, 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-900002', '2026-10-02 10:00:00+00', 'a0000000-0000-7000-8000-0000000008a2', 3500, 'a0000000-0000-7000-8000-000000000a13', false, 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'OSPOS-EXP-1', '2026-10-03 10:00:00+00', 'a0000000-0000-7000-8000-0000000008a2', 1500, null, true, 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-900004', '2026-10-04 10:00:00+00', 'a0000000-0000-7000-8000-0000000008a2', 999, 'a0000000-0000-7000-8000-000000000a13', false, 'voided');

create function pg_temp.rep() returns jsonb language sql as $$
  select report_expenses_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-31')
$$;

select is((pg_temp.rep() -> 'total' ->> 'amount')::bigint, 20000::bigint, 'totals the posted expenses of the period (a voided one is left out, Cairo days decide the period)');
select is((pg_temp.rep() -> 'total' ->> 'count')::int, 3, 'three expenses');
select is((pg_temp.rep() -> 'by_category' -> 0 ->> 'category'), 'كهرباء تقرير', 'categories come biggest first');
select is((pg_temp.rep() -> 'by_category' -> 1 ->> 'amount')::bigint, 5000::bigint, 'the second category adds the device and the imported expense');
select is((pg_temp.rep() -> 'by_day' -> 0 ->> 'day'), '2026-10-01', 'by day uses the Cairo date');
select is((pg_temp.rep() ->> 'legacy_count')::int, 1, 'the imported expense is counted');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((select (report_expenses('2026-10-01', '2026-10-31') -> 'data' -> 'total' ->> 'amount')::bigint), 20000::bigint, 'the RPC answers a manager device');

select * from finish();
rollback;
