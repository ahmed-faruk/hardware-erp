begin;
select plan(12);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- one-line cash sale of product 1 (seed cost 700), the line and the movement carry p_cost
create function pg_temp.sale(p_inv uuid, p_number text, p_cost bigint) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', 'sales_invoices', 'op', 'upsert', 'record', jsonb_build_object(
    'id', p_inv, 'number', p_number, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d1',
    'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1',
    'subtotal', 1250, 'total', 1250,
    'lines', jsonb_build_array(jsonb_build_object('id', md5(p_inv::text)::uuid, 'invoice_id', p_inv,
      'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'line_no', 1, 'product_id', 'a0000000-0000-7000-8000-000000000001',
      'unit_factor', 1000, 'qty', 1000, 'unit_price', 1250, 'net_amount', 1250, 'unit_cost', p_cost)),
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
      'document_type', 'sales_invoice', 'document_id', p_inv, 'method', 'cash', 'amount', 1250,
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a11')),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', -1000,
      'unit_cost', p_cost, 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'line_id', md5(p_inv::text)::uuid, 'occurred_at', now())),
    'party_ledger', '[]'::jsonb,
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1',
      'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'amount', 1250, 'method', 'cash', 'doc_type', 'sales_invoice',
      'doc_id', p_inv, 'occurred_at', now())))); 
$$;

create function pg_temp.master(p_table text, p_actor uuid, p_rec jsonb, p_fields jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_actor, 'record', p_rec,
                            'changed_fields', p_fields, 'base_version', 1);
$$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;

-- the cashier phone (device M1, cashier level) sends cost 0; the server puts the product's cost
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.sale('0190f000-0000-7000-8000-0000000000c1', 'M1-INV-000001', 0)))), null, 'cashier device sale accepted');
reset role;
select is((select unit_cost from sales_invoice_lines where invoice_id = '0190f000-0000-7000-8000-0000000000c1'), 700::bigint, 'server puts the product cost on the line');
select is((select unit_cost from stock_movements where doc_id = '0190f000-0000-7000-8000-0000000000c1'), 700::bigint, 'and on the stock movement');

-- a manager device keeps the cost it sent
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.sale('0190f000-0000-7000-8000-0000000000c2', 'K1-INV-000001', 650)));
reset role;
select is((select unit_cost from sales_invoice_lines where invoice_id = '0190f000-0000-7000-8000-0000000000c2'), 650::bigint, 'manager device keeps its own cost');

-- settings: managers only
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('settings', 'a0000000-0000-7000-8000-0000000000d3',
  jsonb_build_object('id', gen_random_uuid(), 'key', 'sale.cashierMayDiscount', 'value', 'true'::jsonb, 'created_by', 'a0000000-0000-7000-8000-0000000000d3'))))), null, 'a manager can save a setting');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('settings', 'a0000000-0000-7000-8000-0000000000d1',
  jsonb_build_object('id', gen_random_uuid(), 'key', 'sale.other', 'value', 'true'::jsonb, 'created_by', 'a0000000-0000-7000-8000-0000000000d1'))))), 'E_FORBIDDEN', 'a cashier cannot');
reset role;

-- customers: a cashier may only create one, with limit 0 and no discount
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d1',
  jsonb_build_object('id', gen_random_uuid(), 'name', 'New at counter', 'created_by', 'a0000000-0000-7000-8000-0000000000d1'))))), null, 'a cashier can add a customer');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d1',
  jsonb_build_object('id', gen_random_uuid(), 'name', 'Greedy', 'credit_limit', 5000, 'created_by', 'a0000000-0000-7000-8000-0000000000d1'))))), 'E_FORBIDDEN', 'but not with a credit limit');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d1',
  jsonb_build_object('id', 'a0000000-0000-7000-8000-000000000c01', 'name', 'Renamed', 'created_by', 'a0000000-0000-7000-8000-0000000000d1'), '["name"]'::jsonb)))), 'E_FORBIDDEN', 'and cannot edit an existing customer');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d3',
  jsonb_build_object('id', 'a0000000-0000-7000-8000-000000000c01', 'name', 'Renamed by manager', 'created_by', 'a0000000-0000-7000-8000-0000000000d3'), '["name"]'::jsonb)))), null, 'a manager can');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d1',
  jsonb_build_object('id', gen_random_uuid(), 'name', 'Wholesale wannabe', 'price_list', 'wholesale', 'created_by', 'a0000000-0000-7000-8000-0000000000d1'))))), 'E_FORBIDDEN', 'a cashier cannot create a customer on a price list');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.master('customers', 'a0000000-0000-7000-8000-0000000000d3',
  jsonb_build_object('id', gen_random_uuid(), 'name', 'Wholesale buyer', 'price_list', 'wholesale', 'created_by', 'a0000000-0000-7000-8000-0000000000d3'))))), null, 'a manager can');
reset role;

select * from finish();
rollback;
