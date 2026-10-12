begin;
select plan(9);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

insert into categories (id, company_id, name, color_token) values
  ('a0000000-0000-7000-8000-0000000007a1', 'a0000000-0000-7000-8000-000000000001', 'دهانات تقرير', 'cat-1'),
  ('a0000000-0000-7000-8000-0000000007a2', 'a0000000-0000-7000-8000-000000000001', 'سباكة تقرير', 'cat-2');
insert into products (id, company_id, name, base_unit_name, type, price, unit_cost, category_id, legacy_item_id) values
  ('a0000000-0000-7000-8000-0000000007b1', 'a0000000-0000-7000-8000-000000000001', 'دهان تقرير', 'pcs', 'stock', 10000, 6000, 'a0000000-0000-7000-8000-0000000007a1', 5001),
  ('a0000000-0000-7000-8000-0000000007b2', 'a0000000-0000-7000-8000-000000000001', 'ماسورة تقرير', 'pcs', 'stock', 2000, 1000, 'a0000000-0000-7000-8000-0000000007a2', null);
-- stock: 5 paint (cost 60.00) and 10 pipes (cost 10.00)
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000007b1', 'a0000000-0000-7000-8000-0000000000c1', 5000, 6000, 'opening', gen_random_uuid(), '2026-01-01 10:00:00+00'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000007b2', 'a0000000-0000-7000-8000-0000000000c1', 10000, 1000, 'opening', gen_random_uuid(), '2026-01-01 10:00:00+00');
-- 3 Nov: a device sale of 2 paint (200.00, cost 120.00) + 3 pipes (60.00, cost 30.00); an imported sale of 1 paint (100.00, cost 60.00) and a line without a product (25.00)
insert into sales_invoices (id, company_id, number, issued_at, subtotal, total, status, is_legacy) values
  ('0190f000-0000-7000-8000-0000000007c1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-700001', '2026-11-03 10:00:00+00', 26000, 26000, 'posted', false);
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, alloc_discount, is_legacy) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007c1', 1, 'a0000000-0000-7000-8000-0000000007b1', 1000, 2000, 10000, 20000, 6000, 0, 0, false),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007c1', 2, 'a0000000-0000-7000-8000-0000000007b2', 1000, 3000, 2000, 6000, 1000, 0, 0, false);
-- the imported sale (compact tables): 1 paint (100.00, cost 60.00) and a line of a product nobody matches (25.00)
insert into legacy_sales (company_id, id, kind, day, total, cash) values ('a0000000-0000-7000-8000-000000000001', 700002, 0, '2026-11-04', 12500, 12500);
insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost) values (700002, 1, 5001, null, 1000, 10000, 6000), (700002, 2, null, 'صنف محذوف', 1000, 2500, 0);
-- a return of 1 paint on 5 Nov (100.00 back, cost 60.00 back)
insert into sales_returns (id, company_id, number, issued_at, total, refund_method, status) values
  ('0190f000-0000-7000-8000-0000000007d1', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-700001', '2026-11-05 10:00:00+00', 10000, 'cash', 'posted');
insert into sales_return_lines (id, company_id, return_id, product_id, qty, net_amount, unit_cost) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007d1', 'a0000000-0000-7000-8000-0000000007b1', 1000, 10000, 6000);

create function pg_temp.rep() returns jsonb language sql as $$
  select report_categories_core('a0000000-0000-7000-8000-000000000001', '2026-11-01', '2026-11-30')
$$;
create function pg_temp.cat(p_id text) returns jsonb language sql as $$
  select c from jsonb_array_elements(pg_temp.rep() -> 'categories') c where c ->> 'id' = p_id
$$;

select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a1') ->> 'revenue')::bigint, 20000::bigint, 'paint: 200 + 100 imported - 100 returned');
select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a1') ->> 'cost')::bigint, 12000::bigint, 'paint cost: 120 + 60 - 60');
select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a1') ->> 'qty')::bigint, 2000::bigint, 'paint quantity 2 + 1 - 1');
select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a1') ->> 'invoices')::int, 2, 'two invoices sold paint (the return is not an invoice)');
select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a2') ->> 'revenue')::bigint, 6000::bigint, 'pipes: 60.00');
select is((pg_temp.cat('a0000000-0000-7000-8000-0000000007a1') ->> 'stock_value')::bigint, 30000::bigint, 'stock value of paint: 5 x 60.00');
select is((select (c ->> 'revenue')::bigint from jsonb_array_elements(pg_temp.rep() -> 'categories') c where c ->> 'id' is null), 2500::bigint, 'a line without a product counts under no category');
select is(((pg_temp.rep() -> 'total') ->> 'revenue')::bigint, 28500::bigint, 'total revenue of the period');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((select (report_categories('2026-11-01', '2026-11-30') -> 'data' -> 'total' ->> 'revenue')::bigint), 28500::bigint, 'the RPC answers a manager device');

select * from finish();
rollback;
