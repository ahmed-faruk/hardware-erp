begin;
select plan(24);

-- fixtures (seed.sql): company A devices K1 (manager), K2 (manager), M1 (cashier phone); company B device B1.
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.bundle(p_inv uuid, p_num text, p_total bigint default 1250) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_inv, 'number', p_num, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d1',
    'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1',
    'subtotal', 1250, 'total', p_total, 'cash_tendered', 1250,
    'lines', jsonb_build_array(jsonb_build_object(
      'id', md5(p_inv::text)::uuid, 'invoice_id', p_inv, 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'line_no', 1,
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'unit_factor', 1000, 'qty', 1000,
      'unit_price', 1250, 'net_amount', 1250, 'unit_cost', 700)),
    'payments', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'document_type', 'sales_invoice',
      'document_id', p_inv, 'method', 'cash', 'amount', 1250, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11')),
    'stock_movements', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1',
      'qty', -1000, 'unit_cost', 700, 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'line_id', md5(p_inv::text)::uuid, 'occurred_at', now())),
    'party_ledger', '[]'::jsonb,
    'cash_movements', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'amount', 1250, 'method', 'cash',
      'doc_type', 'sales_invoice', 'doc_id', p_inv, 'occurred_at', now())));
$$;

create function pg_temp.row_of(p_seq bigint, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', p_seq, 'table', 'sales_invoices', 'op', 'upsert', 'record', p_rec);
$$;

select set_config('t.inv1', pg_temp.bundle('0190f000-0000-7000-8000-000000000001', 'K1-INV-000001')::text, true);
select set_config('t.inv2', pg_temp.bundle('0190f000-0000-7000-8000-000000000002', 'K1-INV-000002')::text, true);
select set_config('t.bad_total', pg_temp.bundle('0190f000-0000-7000-8000-000000000003', 'K1-INV-000003', 9999)::text, true);

-- 1. RLS is enabled everywhere
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0, 'RLS enabled on every public table');

-- 2. cost visibility
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3'); -- M1: cashier phone
select is((select count(*)::int from products), 0, 'cashier device cannot read the base products table');
select is((select count(*)::int from products_public), 20, 'cashier device reads products through the view');
select throws_ok($$select unit_cost from products_public$$, '42703', null, 'view has no unit_cost');
select is((select count(*)::int from products_public where company_id = 'b0000000-0000-7000-8000-000000000001'), 0, 'company A phone sees no company B rows');
select ok(not exists (select 1 from jsonb_array_elements(pull_changes(0, 1000) -> 'data' -> 'rows') r
                       where r ->> 'table' = 'products' and r -> 'record' ? 'unit_cost'), 'pull strips unit_cost for cashier devices');
reset role;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1'); -- K1: manager
select is((select count(*)::int from products), 20, 'manager device reads the base products table');
select ok(exists (select 1 from jsonb_array_elements(pull_changes(0, 1000) -> 'data' -> 'rows') r
                   where r ->> 'table' = 'products' and r -> 'record' ? 'unit_cost'), 'pull keeps unit_cost for manager devices');
select is((select count(*)::int from products where company_id = 'b0000000-0000-7000-8000-000000000001'), 0, 'company A manager sees no company B rows');

-- 3. clients cannot write directly
select throws_ok($$insert into customers (id, company_id, name) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'x')$$,
  '42501', null, 'no direct insert for authenticated');

-- 4. ingest: idempotent, atomic per document, rejects do not stop the batch
select is(((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0',
  jsonb_build_array(pg_temp.row_of(1, current_setting('t.inv1')::jsonb)))) -> 'data' -> 'rejected'), '[]'::jsonb, 'valid invoice accepted');
select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0', jsonb_build_array(pg_temp.row_of(1, current_setting('t.inv1')::jsonb)));
reset role;
select is((select count(*)::int from sales_invoices where number = 'K1-INV-000001'), 1, 'same batch twice gives one invoice');
select is((select count(*)::int from stock_movements where doc_id = '0190f000-0000-7000-8000-000000000001'), 1, 'and one stock movement');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0', jsonb_build_array(
    pg_temp.row_of(2, current_setting('t.bad_total')::jsonb),
    pg_temp.row_of(3, current_setting('t.inv2')::jsonb)))) -> 'data' -> 'rejected' -> 0 ->> 'seq')::int, 2, 'bad row is rejected');
reset role;
select is((select count(*)::int from sales_invoices where number in ('K1-INV-000002', 'K1-INV-000003')), 1, 'the next row in the batch still lands');
select is((select count(*)::int from sales_invoices where number = 'K1-INV-000003'), 0, 'the rejected invoice left nothing behind');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0', jsonb_build_array(jsonb_build_object(
    'seq', 4, 'table', 'products', 'op', 'upsert', 'changed_fields', jsonb_build_array('name'), 'base_version', 1,
    'record', jsonb_build_object('id', 'b0000000-0000-7000-8000-000000000001', 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'name', 'hacked'))))
  ) -> 'data' -> 'rejected' -> 0 ->> 'code'), 'E_FORBIDDEN', 'cannot edit another company record by id');
reset role;
select is((select name from products where id = 'b0000000-0000-7000-8000-000000000001'), 'Other shop product', 'company B product unchanged');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');

-- 5. service-role only
select throws_ok($$select import_batch('x', '[]')$$, 'P0001', 'E_FORBIDDEN', 'import_batch refuses authenticated devices');
reset role;

-- 6. device activation: one use, expires
insert into devices (id, company_id, name, prefix, kind, max_role)
values ('a0000000-0000-7000-8000-0000000000f9', 'a0000000-0000-7000-8000-000000000001', 'New', 'N1', 'pc', 'cashier');
insert into device_activations (device_id, code_hash, expires_at) values
  ('a0000000-0000-7000-8000-0000000000f9', encode(extensions.digest('GOODCODE12', 'sha256'), 'hex'), now() + interval '1 day'),
  ('a0000000-0000-7000-8000-0000000000f9', encode(extensions.digest('OLDCODE123', 'sha256'), 'hex'), now() - interval '1 minute');
insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-7000-8000-0000000000e9', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1@devices.test.local'),
  ('a0000000-0000-7000-8000-0000000000ea', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2@devices.test.local');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e9');
select is((claim_device_activation('OLDCODE123') ->> 'ok')::boolean, false, 'expired code is refused');
select is((claim_device_activation('goodcode12') ->> 'ok')::boolean, true, 'valid code links the device');
reset role;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000ea');
select is((claim_device_activation('GOODCODE12') ->> 'ok')::boolean, false, 'a code works only once');
reset role;

-- 7. revoked device: every RPC raises
update devices set revoked_at = now() where id = 'a0000000-0000-7000-8000-0000000000f2';
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e2');
select throws_ok($$select ping()$$, 'P0001', 'E_DEVICE_REVOKED', 'revoked device cannot ping');
select throws_ok($$select pull_changes(0, 10)$$, 'P0001', 'E_DEVICE_REVOKED', 'revoked device cannot pull');
reset role;

select * from finish();
rollback;
