begin;
select plan(17);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

update customers set legacy_person_id = 880001 where id = 'a0000000-0000-7000-8000-000000000c01';
update products set legacy_item_id = 880004 where id = 'a0000000-0000-7000-8000-000000000004';
-- imported sales (company A): ids 1001..1006
insert into legacy_sales (company_id, id, kind, day, customer_id, total, cash, card, credit, other) values
  ('a0000000-0000-7000-8000-000000000001', 1001, 0, '2020-01-10', 880001, 10000, 10000, 0, 0, 0),
  ('a0000000-0000-7000-8000-000000000001', 1002, 0, '2020-02-10', null, 25000, 0, 25000, 0, 0),
  ('a0000000-0000-7000-8000-000000000001', 1003, 0, '2020-03-10', 880001, 40000, 10000, 0, 30000, 0),
  ('a0000000-0000-7000-8000-000000000001', 1004, 1, '2020-03-11', 880001, 5000, 5000, 0, 0, 0),
  ('a0000000-0000-7000-8000-000000000001', 1005, 0, '2020-03-12', null, 700, 0, 0, 0, 700),
  ('a0000000-0000-7000-8000-000000000001', 1006, 0, '2020-04-01', null, 100000, 100000, 0, 0, 0);
insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost) values
  (1001, 1, 880004, null, 1000, 10000, 5000),
  (1002, 1, null, 'صنف غير مطابق', 2000, 25000, 12000),
  (1003, 1, 880004, null, 4000, 40000, 20000),
  (1004, 1, 880004, null, -1000, -5000, -2500);
-- another company's sale must never be found
insert into legacy_sales (company_id, id, kind, day, total, cash) values ('b0000000-0000-7000-8000-000000000001', 2001, 0, '2020-01-10', 10000, 10000);
-- many sales on one day, for the page limit
insert into legacy_sales (company_id, id, kind, day, total, cash)
select 'a0000000-0000-7000-8000-000000000001', 5000 + g, 0, '2019-06-01', 100, 100 from generate_series(1, 120) g;

create function pg_temp.s(p_args text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'select search_legacy_sales_core(''a0000000-0000-7000-8000-000000000001'', ' || p_args || ')' into r;
  return r;
end $$;
-- args: from, to, number, customer, min, max, method, product, kind, offset
select is((pg_temp.s('null, null, null, null, null, null, null, null, null, 0') ->> 'matched')::int, 126, 'no filter: every sale of this company (and none of another)');
select is((pg_temp.s('null, null, null, null, null, null, null, null, null, 0') -> 'rows' ->> 0), (pg_temp.s('null, null, null, null, null, null, null, null, null, 0') -> 'rows' -> 0)::text, 'rows come as a list');
select is(jsonb_array_length(pg_temp.s('null, null, null, null, null, null, null, null, null, 0') -> 'rows'), 100, 'a page holds 100 rows');
select is(jsonb_array_length(pg_temp.s('null, null, null, null, null, null, null, null, null, 100') -> 'rows'), 26, 'the next page holds the rest');
select is((pg_temp.s('''2020-02-10'', ''2020-03-10'', null, null, null, null, null, null, null, 0') ->> 'matched')::int, 2, 'dates: both ends included');
select is((pg_temp.s('null, null, ''1002'', null, null, null, null, null, null, 0') -> 'rows' -> 0 ->> 'number'), 'LG-INV-001002', 'number: digits of the OpenSourcePOS number');
select is((pg_temp.s('null, null, null, ''عميل'', null, null, null, null, null, 0') ->> 'matched')::int, 0, 'customer: a name that nobody has finds nothing');
select is((pg_temp.s('null, null, null, ''Test Customer'', null, null, null, null, null, 0') ->> 'matched')::int, 3, 'customer: part of the name (3 sales and the return of that customer)');
select is((pg_temp.s('null, null, null, null, 20000, 50000, null, null, null, 0') ->> 'matched')::int, 2, 'amount range, inclusive');
select is((pg_temp.s('null, null, null, null, null, null, ''card'', null, null, 0') ->> 'matched')::int, 1, 'method: paid by card');
select is((pg_temp.s('null, null, null, null, null, null, ''credit'', null, null, 0') -> 'rows' -> 0 ->> 'id')::int, 1003, 'method: on credit');
select is((pg_temp.s('null, null, null, null, null, null, null, ''Test product 4'', null, 0') ->> 'matched')::int, 3, 'product: by the name of the matched item (2 sales and a return)');
select is((pg_temp.s('null, null, null, null, null, null, null, ''غير مطابق'', null, 0') -> 'rows' -> 0 ->> 'id')::int, 1002, 'product: by the text of an unmatched line');
select is((pg_temp.s('null, null, null, null, null, null, null, null, 1, 0') -> 'rows' -> 0 ->> 'number'), 'LG-RET-001004', 'kind: returns only, numbered LG-RET');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select throws_ok($$select search_legacy_sales()$$, 'P0001', 'E_FORBIDDEN:للمدير فقط', 'a cashier device is refused');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((search_legacy_sales(null, null, '1003') -> 'data' -> 'rows' -> 0 ->> 'total')::bigint, 40000::bigint, 'a manager device gets the answer');
select is(jsonb_array_length(legacy_sale_detail(1001) -> 'data' -> 'lines'), 1, 'the detail has its lines (and the matched product name)');

select * from finish();
rollback;
