begin;
select plan(11);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

update workers set legacy_employee_id = 88 where id = 'a0000000-0000-7000-8000-0000000000d1';
insert into suppliers (id, company_id, name, legacy_person_id) values ('a0000000-0000-7000-8000-0000000006b1', 'a0000000-0000-7000-8000-000000000001', 'مورد مضغوط', 6001);

-- the service role imports the history in compact form
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((import_legacy_batch('legacy_sales', jsonb_build_array(
  jsonb_build_object('company_id', 'a0000000-0000-7000-8000-000000000001', 'id', 5001, 'kind', 0, 'day', '2019-03-10', 'employee_id', 88, 'total', 30000, 'cash', 20000, 'card', 0, 'credit', 10000, 'other', 0),
  jsonb_build_object('company_id', 'a0000000-0000-7000-8000-000000000001', 'id', 5002, 'kind', 1, 'day', '2019-03-11', 'employee_id', null, 'total', 5000, 'cash', 5000, 'card', 0, 'credit', 0, 'other', 0))) -> 'data' ->> 'inserted')::int, 2, 'the service role imports sales and returns');
select is((import_legacy_batch('legacy_sales', jsonb_build_array(
  jsonb_build_object('company_id', 'a0000000-0000-7000-8000-000000000001', 'id', 5001, 'kind', 0, 'day', '2019-03-10', 'employee_id', null, 'total', 30000, 'cash', 0, 'card', 0, 'credit', 0, 'other', 0))) -> 'data' ->> 'inserted')::int, 0, 'importing a row again inserts nothing');
select import_legacy_batch('legacy_sale_lines', jsonb_build_array(
  jsonb_build_object('sale_id', 5001, 'line_no', 1, 'qty', 2000, 'net', 30000, 'cost', 18000),
  jsonb_build_object('sale_id', 5002, 'line_no', 1, 'qty', 1000, 'net', 5000, 'cost', 3000)));
select import_legacy_batch('legacy_purchases', jsonb_build_array(
  jsonb_build_object('company_id', 'a0000000-0000-7000-8000-000000000001', 'id', 6001, 'kind', 0, 'day', '2019-03-05', 'supplier_id', 6001, 'total', 50000, 'cash', 20000, 'credit', 30000, 'other', 0),
  jsonb_build_object('company_id', 'a0000000-0000-7000-8000-000000000001', 'id', 6002, 'kind', 1, 'day', '2019-03-06', 'supplier_id', 6001, 'total', 4000, 'cash', 4000, 'credit', 0, 'other', 0)));
select is((import_legacy_batch('products', '[{"id": 1}]') -> 'error' ->> 'code'), 'E_VALIDATION', 'only the compact tables are allowed');
reset role;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select import_legacy_batch('legacy_sales', '[{"id": 1}]')$$, 'P0001', 'E_FORBIDDEN', 'a device cannot import history');
select throws_ok($$select count(*) from legacy_sales$$, '42501', null, 'a device cannot read the compact tables at all (only the report functions do)');
reset role;

select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') #>> '{total,net}', '25000', 'sales summary: 300.00 sale minus a 50.00 return');
select is((select (m ->> 'amount')::bigint from jsonb_array_elements(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') -> 'by_method') m where m ->> 'method' = 'credit'), 10000::bigint, 'payment split by method comes from the compact columns');
select is((select w ->> 'worker' from jsonb_array_elements(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') -> 'by_worker') w limit 1), (select name from workers where id = 'a0000000-0000-7000-8000-0000000000d1'), 'the cashier is found through the legacy employee id');
select is(report_profit_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') #>> '{total,profit}', '10000', 'profit = (300.00 - 180.00) - (50.00 - 30.00) = 100.00');
select is(report_purchases_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') #>> '{total,credit}', '30000', 'purchases report: the credit part of the imported purchase');
select is(report_purchases_core('a0000000-0000-7000-8000-000000000001', '2019-03-01', '2019-03-31') #>> '{by_supplier,0,returns}', '4000', 'and its return, under the supplier found through the legacy person id');

select * from finish();
rollback;
