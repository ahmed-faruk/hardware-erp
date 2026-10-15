begin;
select plan(9);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
-- a device creates a product / a supplier, or edits a supplier's name
create function pg_temp.new_product(p_worker uuid, p_id uuid, p_name text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'products', 'op', 'upsert', 'worker_id', p_worker, 'changed_fields', '[]'::jsonb,
    'record', jsonb_build_object('id', p_id, 'name', p_name, 'base_unit_name', 'pcs', 'created_by', p_worker, 'qty_decimals', 0)));
$$;
create function pg_temp.new_supplier(p_worker uuid, p_id uuid, p_name text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'suppliers', 'op', 'upsert', 'worker_id', p_worker, 'changed_fields', '[]'::jsonb,
    'record', jsonb_build_object('id', p_id, 'name', p_name, 'created_by', p_worker)));
$$;
create function pg_temp.rename_supplier(p_worker uuid, p_id uuid, p_name text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'suppliers', 'op', 'upsert', 'worker_id', p_worker, 'changed_fields', jsonb_build_array('name'),
    'base_version', (select version from suppliers where id = p_id),
    'record', jsonb_build_object('id', p_id, 'name', p_name, 'version', (select version + 1 from suppliers where id = p_id), 'updated_at', now())));
$$;
create function pg_temp.push(p_rows jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', p_rows));
$$;

-- group A removes addProduct from a worker (cashier d1 here has editProductData through it); group B gives addSupplier
insert into permission_groups (id, company_id, name, permissions) values
  ('0190f000-0000-7000-8000-0000000000a1', 'a0000000-0000-7000-8000-000000000001', 'يعدل بس', '{"editProductData": "yes"}'),
  ('0190f000-0000-7000-8000-0000000000a2', 'a0000000-0000-7000-8000-000000000001', 'يضيف مورد', '{"addSupplier": "yes"}');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.new_product('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-0000000000b1', 'صنف من المخزن')), null, 'a storekeeper adds a product (addProduct by default)');
select is(pg_temp.push(pg_temp.new_product('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-0000000000b2', 'صنف المدير')), null, 'a manager adds a product');
select is(pg_temp.push(pg_temp.new_product('a0000000-0000-7000-8000-0000000000d1', '0190f000-0000-7000-8000-0000000000b3', 'صنف كاشير')), 'E_FORBIDDEN', 'a cashier cannot');
reset role;
update workers set group_id = '0190f000-0000-7000-8000-0000000000a1' where id = 'a0000000-0000-7000-8000-0000000000d2';
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.new_product('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-0000000000b4', 'صنف تاني')), 'E_FORBIDDEN', 'a storekeeper whose group lacks addProduct cannot');
select is(pg_temp.push(pg_temp.new_supplier('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-0000000000c1', 'مورد المدير')), null, 'a manager adds a supplier');
select is(pg_temp.push(pg_temp.new_supplier('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-0000000000c2', 'مورد المخزن')), 'E_FORBIDDEN', 'a storekeeper without addSupplier cannot');
reset role;
update workers set group_id = '0190f000-0000-7000-8000-0000000000a2' where id = 'a0000000-0000-7000-8000-0000000000d2';
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.new_supplier('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-0000000000c3', 'مورد بصلاحية')), null, 'with a group that gives addSupplier he can');
select is(pg_temp.push(pg_temp.rename_supplier('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-0000000000c1', 'اسم تاني')), 'E_FORBIDDEN', 'but he cannot edit an existing supplier');
select is(pg_temp.push(pg_temp.rename_supplier('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-0000000000c1', 'اسم المدير')), null, 'a manager edits it');
reset role;

select * from finish();
rollback;
