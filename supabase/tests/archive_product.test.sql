begin;
select plan(11);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$
  select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
-- a device sets or clears deleted_at on a product (only that field changes)
create function pg_temp.set_deleted(p_product uuid, p_worker uuid, p_gone boolean) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'products', 'op', 'upsert', 'worker_id', p_worker,
    'changed_fields', jsonb_build_array('deleted_at'), 'base_version', (select version from products where id = p_product),
    'record', jsonb_build_object('id', p_product, 'deleted_at', case when p_gone then to_jsonb(now()) else 'null'::jsonb end, 'updated_at', now(), 'version', (select version + 1 from products where id = p_product))));
$$;
create function pg_temp.push(p_product uuid, p_worker uuid, p_gone boolean) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', pg_temp.set_deleted(p_product, p_worker, p_gone)));
$$;

-- P11: history and stock 0 (+1 then -1 sold); P12: history and stock 3; P13: never used; P14: history, stock 0; P15: history, stock 0
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at)
select gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', ('a0000000-0000-7000-8000-' || lpad(p::text, 12, '0'))::uuid, 'a0000000-0000-7000-8000-0000000000c1', q, 100, d, gen_random_uuid(), now()
from (values (11, 1000, 'opening'), (11, -1000, 'sales_invoice'), (12, 3000, 'opening'), (14, 1000, 'opening'), (14, -1000, 'sales_invoice'), (15, 1000, 'opening'), (15, -1000, 'sales_invoice')) v (p, q, d);
-- a group that gives a cashier both rights, on worker d1
insert into permission_groups (id, company_id, name, permissions) values ('0190f000-0000-7000-8000-0000000000a9', 'a0000000-0000-7000-8000-000000000001', 'أرشفة', '{"editProductData": "yes", "archiveProduct": "yes"}');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000011', 'a0000000-0000-7000-8000-0000000000d3', true), null, 'a manager archives a product with history at stock 0');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000012', 'a0000000-0000-7000-8000-0000000000d3', true), 'E_IN_USE', 'with stock on hand the server refuses');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000014', 'a0000000-0000-7000-8000-0000000000d2', true), 'E_FORBIDDEN', 'a storekeeper cannot archive a product with history');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000013', 'a0000000-0000-7000-8000-0000000000d2', true), null, 'but still deletes a product that never moved');
reset role;
update workers set group_id = '0190f000-0000-7000-8000-0000000000a9' where id = 'a0000000-0000-7000-8000-0000000000d1';
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000015', 'a0000000-0000-7000-8000-0000000000d1', true), null, 'a worker whose group has archiveProduct may archive');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000011', 'a0000000-0000-7000-8000-0000000000d2', false), 'E_FORBIDDEN', 'a storekeeper cannot restore an archived product with history');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000011', 'a0000000-0000-7000-8000-0000000000d3', false), null, 'a manager restores it');
select is(pg_temp.push('a0000000-0000-7000-8000-000000000013', 'a0000000-0000-7000-8000-0000000000d2', false), null, 'a never-used deleted product restores with editProductData');
reset role;
select is((select deleted_at is null from products where id = 'a0000000-0000-7000-8000-000000000011'), true, 'the restored product is live again');
select is((select deleted_at is not null from products where id = 'a0000000-0000-7000-8000-000000000015'), true, 'the archived product is gone from the live list');
select is((select deleted_at is null from products where id = 'a0000000-0000-7000-8000-000000000012'), true, 'the product with stock was not touched');

select * from finish();
rollback;
