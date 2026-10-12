begin;
select plan(11);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$
  select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
-- a device delete: the product row with deleted_at and only that field changed
create function pg_temp.delete_row(p_product uuid, p_worker uuid) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'products', 'op', 'upsert', 'worker_id', p_worker,
    'changed_fields', jsonb_build_array('deleted_at'), 'base_version', (select version from products where id = p_product),
    'record', jsonb_build_object('id', p_product, 'deleted_at', now(), 'updated_at', now(), 'version', (select version + 1 from products where id = p_product))));
$$;

-- P0001 unused, P0002 has a stock movement, P0003 only has imported (legacy) sales, P0004 holds stock, P0005 only legacy purchases
update products set legacy_item_id = 880003 where id = 'a0000000-0000-7000-8000-000000000003';
update products set legacy_item_id = 880005 where id = 'a0000000-0000-7000-8000-000000000005';
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000002', 'a0000000-0000-7000-8000-0000000000c1', 5000, 600, 'opening', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000004', 'a0000000-0000-7000-8000-0000000000c1', 3000, 600, 'opening', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000004', 'a0000000-0000-7000-8000-0000000000c1', -3000, 600, 'sales_invoice', gen_random_uuid(), now());
insert into legacy_sales (company_id, id, kind, day, total, cash) values ('a0000000-0000-7000-8000-000000000001', 990001, 0, '2020-01-10', 1500, 1500);
insert into legacy_sale_lines (sale_id, line_no, product_id, qty, net, cost) values (990001, 1, 880003, 1000, 1500, 800);
insert into legacy_purchases (company_id, id, kind, day, total, cash) values ('a0000000-0000-7000-8000-000000000001', 990002, 0, '2020-01-11', 800, 800);
insert into legacy_purchase_lines (purchase_id, line_no, product_id, qty, net) values (990002, 1, 880005, 1000, 800);

select is(product_usage_core('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000001') ->> 'movements', '0', 'C1 an untouched product has no usage');
select ok(not product_in_use('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000001'), 'C1 and is not in use');
select ok(product_in_use('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000002'), 'C4 a stock movement blocks it');
select ok(product_in_use('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000003'), 'C6 imported sales block it');
select ok(product_in_use('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000005'), 'C6 imported purchases block it');
select is((product_usage_core('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000004') ->> 'stock_milli'), '0', 'a product that moved but is back to zero stock still counts as moved');
select ok(product_in_use('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000004'), 'C4 history blocks it even at zero stock');
select is(product_usage_core('b0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000001'), null, 'another company cannot read this product');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', pg_temp.delete_row('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000d3'))), null, 'C1 the server accepts the delete of an unused product');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', pg_temp.delete_row('a0000000-0000-7000-8000-000000000002', 'a0000000-0000-7000-8000-0000000000d3'))), 'E_IN_USE', 'C9 and refuses the delete of a product in use');
select is((product_usage('a0000000-0000-7000-8000-000000000003') -> 'data' ->> 'legacy_sales'), '1', 'the manager device reads the usage over the RPC');

select * from finish();
rollback;
