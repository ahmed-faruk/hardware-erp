begin;
select plan(9);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- a product with imported history (3 lines, no movements) and device history after the import
insert into products (id, company_id, name, base_unit_name, type, price, unit_cost)
values ('a0000000-0000-7000-8000-0000000009a1', 'a0000000-0000-7000-8000-000000000001', 'صنف التاريخ', 'pcs', 'stock', 1000, 500);
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-0000000009b1', 'a0000000-0000-7000-8000-000000000001', 'مورد قديم');
-- legacy purchase of 13 (1 Apr) and legacy sale of 3 (1 May): they never produced stock movements
insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total, status, is_legacy)
values ('0190f000-0000-7000-8000-0000000009c1', 'a0000000-0000-7000-8000-000000000001', 'OSPOS-R1', '2026-04-01 10:00:00+00', 'a0000000-0000-7000-8000-0000000009b1', 'a0000000-0000-7000-8000-0000000000c1', 1300, 1300, 'posted', true);
insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount, is_legacy)
values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000009c1', 1, 'a0000000-0000-7000-8000-0000000009a1', 1000, 13000, 100, 1300, true);
insert into sales_invoices (id, company_id, number, issued_at, subtotal, total, worker_id, status, is_legacy)
values ('0190f000-0000-7000-8000-0000000009c2', 'a0000000-0000-7000-8000-000000000001', 'OSPOS-S1', '2026-05-01 10:00:00+00', 3000, 3000, 'a0000000-0000-7000-8000-0000000000d1', 'posted', true);
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, is_legacy)
values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000009c2', 1, 'a0000000-0000-7000-8000-0000000009a1', 1000, 3000, 1000, 3000, 500, 0, true);
-- the import: opening stock 10 on 1 Jun; then a sale of 2 (5 Oct) and a purchase of 5 (6 Oct) on a device
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000009a1', 'a0000000-0000-7000-8000-0000000000c1', 10000, 500, 'opening', gen_random_uuid(), '2026-06-01 10:00:00+00'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000009a1', 'a0000000-0000-7000-8000-0000000000c1', -2000, 500, 'sales_invoice', gen_random_uuid(), '2026-10-05 10:00:00+00'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000009a1', 'a0000000-0000-7000-8000-0000000000c1', 5000, 500, 'purchase_invoice', gen_random_uuid(), '2026-10-06 10:00:00+00');

create function pg_temp.hist(p_from date, p_to date, p_offset int default 0) returns jsonb language sql as $$
  select report_product_history_core('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000009a1', p_from, p_to, p_offset)
$$;

select is((pg_temp.hist('2026-01-01', '2026-12-31') ->> 'balance_now')::bigint, 13000::bigint, 'today balance = opening 10 - 2 + 5');
select is((pg_temp.hist('2026-01-01', '2026-12-31') ->> 'count')::int, 5, 'five rows: two legacy lines, the opening and two device movements');
select is((select array_agg(r ->> 'balance' order by ord) from jsonb_array_elements(pg_temp.hist('2026-01-01', '2026-12-31') -> 'rows') with ordinality as t(r, ord)),
  array['13000', '8000', '10000', '10000', '13000'], 'balances after each row, newest first: legacy rows continue from the opening quantity');
select is((select array_agg(r ->> 'legacy' order by ord) from jsonb_array_elements(pg_temp.hist('2026-01-01', '2026-12-31') -> 'rows') with ordinality as t(r, ord)),
  array['false', 'false', 'false', 'true', 'true'], 'imported rows are marked legacy');
select is((pg_temp.hist('2026-10-01', '2026-10-31') ->> 'count')::int, 2, 'the period filters the rows');
select is((pg_temp.hist('2026-10-01', '2026-10-31') -> 'rows' -> 1 ->> 'balance')::bigint, 8000::bigint, 'but the balance of a row does not depend on the period');
select is((pg_temp.hist('2026-01-01', '2026-12-31') -> 'rows' -> 4 ->> 'number'), 'OSPOS-R1', 'a legacy row carries its imported document number');
select is((pg_temp.hist('2026-01-01', '2026-12-31') -> 'rows' -> 4 ->> 'party'), 'مورد قديم', '... and the supplier');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((select (report_product_history('a0000000-0000-7000-8000-0000000009a1', '2026-01-01', '2026-12-31') -> 'data' ->> 'count')::int), 5, 'the RPC answers a manager device');

select * from finish();
rollback;
