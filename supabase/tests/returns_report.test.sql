begin;
select plan(20);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- products 1..4 exist in the seed; product 4 is the imported item 880004
update products set legacy_item_id = 880004 where id = 'a0000000-0000-7000-8000-000000000004';
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-0000000007c1', 'a0000000-0000-7000-8000-000000000001', 'مورد المرتجعات');

-- device sales returns. Cairo is UTC+3 in October: 22:30 UTC on 30 Sep is 1 Oct, 22:30 UTC on 31 Oct is 1 Nov
insert into sales_returns (id, company_id, number, issued_at, total, refund_method, reason, status, customer_id) values
  ('0190f000-0000-7000-8000-00000000a001', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-910001', '2026-10-05 10:00:00+00', 1000, 'cash', 'defect', 'posted', 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-00000000a002', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-910002', '2026-10-06 10:00:00+00', 2500, 'credit', 'wrongItem', 'posted', 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-00000000a003', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-910003', '2026-09-30 22:30:00+00', 700, 'cash', 'changedMind', 'posted', null),
  ('0190f000-0000-7000-8000-00000000a004', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-910004', '2026-10-31 22:30:00+00', 900, 'cash', 'other', 'posted', null),
  ('0190f000-0000-7000-8000-00000000a005', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-910005', '2026-10-07 10:00:00+00', 400, 'cash', 'other', 'voided', null);
insert into sales_return_lines (id, company_id, return_id, product_id, qty, unit_refund, net_amount, unit_cost, condition, warehouse_id) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a001', 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 1000, 700, 'good', 'a0000000-0000-7000-8000-0000000000c1'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a002', 'a0000000-0000-7000-8000-000000000001', 2000, 750, 1500, 700, 'good', 'a0000000-0000-7000-8000-0000000000c1'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a002', 'a0000000-0000-7000-8000-000000000002', 1000, 1000, 1000, 800, 'good', 'a0000000-0000-7000-8000-0000000000c1'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a003', 'a0000000-0000-7000-8000-000000000003', 1000, 700, 700, 500, 'good', 'a0000000-0000-7000-8000-0000000000c1'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a004', 'a0000000-0000-7000-8000-000000000001', 1000, 900, 900, 700, 'good', 'a0000000-0000-7000-8000-0000000000c1'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000a005', 'a0000000-0000-7000-8000-000000000001', 1000, 400, 400, 700, 'good', 'a0000000-0000-7000-8000-0000000000c1');
-- imported sales returns: 5 Oct 3.00 (2.00 cash + 1.00 card) of item 880004; 1 Nov is outside the period; a sale (kind 0) is not a return
insert into legacy_sales (company_id, id, kind, day, total, cash, card) values
  ('a0000000-0000-7000-8000-000000000001', 880001, 1, '2026-10-05', 300, 200, 100),
  ('a0000000-0000-7000-8000-000000000001', 880002, 1, '2026-11-01', 900, 900, 0),
  ('a0000000-0000-7000-8000-000000000001', 880003, 0, '2026-10-05', 5000, 5000, 0);
insert into legacy_sale_lines (sale_id, line_no, product_id, qty, net, cost) values
  (880001, 1, 880004, 1000, 300, 100), (880002, 1, 880004, 1000, 900, 100), (880003, 1, 880004, 1000, 5000, 100);

-- purchase returns: a device one on 10 Oct (supplier مورد المرتجعات), an imported one on 12 Oct without supplier
insert into purchase_returns (id, company_id, number, issued_at, supplier_id, total) values
  ('0190f000-0000-7000-8000-00000000b001', 'a0000000-0000-7000-8000-000000000001', 'K1-PRT-910001', '2026-10-10 10:00:00+00', 'a0000000-0000-7000-8000-0000000007c1', 5000);
insert into purchase_return_lines (id, company_id, return_id, line_no, product_id, qty, unit_cost, net_amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-00000000b001', 1, 'a0000000-0000-7000-8000-000000000001', 2000, 2500, 5000);
insert into legacy_purchases (company_id, id, kind, day, total, cash) values
  ('a0000000-0000-7000-8000-000000000001', 880101, 1, '2026-10-12', 800, 800),
  ('a0000000-0000-7000-8000-000000000001', 880102, 0, '2026-10-12', 9999, 9999);
insert into legacy_purchase_lines (purchase_id, line_no, product_id, qty, net) values (880101, 1, 880004, 1000, 800), (880102, 1, 880004, 1000, 9999);

create function pg_temp.rep() returns jsonb language sql as $$
  select report_returns_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-31')
$$;

select is((pg_temp.rep() -> 'sales' -> 'total' ->> 'count')::int, 4, 'F1 four sales returns: three on devices and one imported (the 1 Nov, the voided and the imported sale are left out)');
select is((pg_temp.rep() -> 'sales' -> 'total' ->> 'amount')::bigint, 4500::bigint, 'F1 their total is 10.00 + 25.00 + 7.00 + 3.00');
select is((pg_temp.rep() -> 'sales' ->> 'legacy_count')::int, 1, 'F1 one of them is imported');
select is((pg_temp.rep() -> 'sales' -> 'by_day' -> 0 ->> 'day') || ':' || (pg_temp.rep() -> 'sales' -> 'by_day' -> 0 ->> 'amount'), '2026-10-01:700', 'F3 the 22:30 UTC return belongs to 1 Oct in Cairo');
select is((pg_temp.rep() -> 'sales' -> 'by_day' -> 1 ->> 'amount')::bigint, 1300::bigint, 'F1 5 Oct adds the device and the imported return');
select is(jsonb_array_length(pg_temp.rep() -> 'sales' -> 'by_day'), 3, 'F3 and nothing falls on 1 Nov');
select is((pg_temp.rep() -> 'sales' -> 'by_product' -> 0 ->> 'product') || ':' || (pg_temp.rep() -> 'sales' -> 'by_product' -> 0 ->> 'qty') || ':' || (pg_temp.rep() -> 'sales' -> 'by_product' -> 0 ->> 'amount'), 'Test product 1:3000:2500', 'F1 by product: the biggest is product 1, 3 units, 25.00');
select is((pg_temp.rep() -> 'sales' -> 'by_product' -> 3 ->> 'product') || ':' || (pg_temp.rep() -> 'sales' -> 'by_product' -> 3 ->> 'amount'), 'Test product 4:300', 'F1 the imported line is matched to its product by the legacy id');
select is((select string_agg((x ->> 'reason') || ':' || (x ->> 'amount'), ',' order by x ->> 'reason') from jsonb_array_elements(pg_temp.rep() -> 'sales' -> 'by_reason') x), 'changedMind:700,defect:1000,unknown:300,wrongItem:2500', 'F1 by reason; imported returns have no reason');
select is((select string_agg((x ->> 'method') || ':' || (x ->> 'amount'), ',' order by x ->> 'method') from jsonb_array_elements(pg_temp.rep() -> 'sales' -> 'by_method') x), 'card:100,cash:1900,credit:2500', 'F1 by refund method, the imported return split as it was paid');
select is((pg_temp.rep() -> 'sales' -> 'list' -> 0 ->> 'number'), 'K1-RET-910002', 'the newest comes first');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rep() -> 'sales' -> 'list') x where x ->> 'number' = 'LG-RET-880001'), 1, 'the imported return is listed under its OpenSourcePOS number');
select is((pg_temp.rep() -> 'purchases' -> 'total' ->> 'count')::int, 2, 'F2 two purchase returns (the imported purchase is not a return)');
select is((pg_temp.rep() -> 'purchases' -> 'total' ->> 'amount')::bigint, 5800::bigint, 'F2 50.00 + 8.00');
select is((pg_temp.rep() -> 'purchases' ->> 'legacy_count')::int, 1, 'F2 one imported');
select is((pg_temp.rep() -> 'purchases' -> 'by_product' -> 0 ->> 'product') || ':' || (pg_temp.rep() -> 'purchases' -> 'by_product' -> 0 ->> 'qty'), 'Test product 1:2000', 'F2 by product');
select is((pg_temp.rep() -> 'purchases' -> 'by_supplier' -> 0 ->> 'supplier') || ':' || (pg_temp.rep() -> 'purchases' -> 'by_supplier' -> 0 ->> 'amount'), 'مورد المرتجعات:5000', 'F2 by supplier');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((select (report_returns('2026-10-01', '2026-10-31') -> 'data' -> 'sales' -> 'total' ->> 'amount')::bigint), 4500::bigint, 'F6 a manager device gets the report');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select throws_ok($$select report_returns('2026-10-01', '2026-10-31')$$, 'P0001', 'E_FORBIDDEN:للمدير فقط', 'F6 a cashier device is refused');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select report_returns('2026-01-01', '2027-12-31')$$, 'P0001', 'E_VALIDATION:فترة غير صالحة', 'a period over 400 days is refused');

select * from finish();
rollback;
