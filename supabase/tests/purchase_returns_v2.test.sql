begin;
select plan(15);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;

-- a purchase on a given day: product p, qty q (milli), net n; the line id is md5(invoice || 'l')
create function pg_temp.purchase_on(p_inv uuid, p_number text, p_supplier uuid, p_prod int, p_qty bigint, p_net bigint, p_at timestamptz) returns void language sql as $$
  insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values
    (p_inv, 'a0000000-0000-7000-8000-000000000001', p_number, p_at, p_supplier, 'a0000000-0000-7000-8000-0000000000c1', p_net, p_net);
  insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values
    (md5(p_inv::text || 'l')::uuid, 'a0000000-0000-7000-8000-000000000001', p_inv, 1, ('a0000000-0000-7000-8000-' || lpad(p_prod::text, 12, '0'))::uuid, 1000, p_qty, p_net * 1000 / p_qty, p_net);
$$;
-- a purchase return: lines are [invoice-id-or-null, product, qty, net]; refund on credit; header invoice null (several invoices) or given
create function pg_temp.pret(p_actor uuid, p_number text, p_supplier uuid, p_lines jsonb, p_approved uuid default null) returns jsonb language plpgsql as $$
declare
  rid uuid := gen_random_uuid();
  ls jsonb := '[]'; sm jsonb := '[]'; total bigint := 0; l jsonb; lid uuid; i int := 0;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1; lid := gen_random_uuid(); total := total + (l ->> 3)::bigint;
    ls := ls || jsonb_build_array(jsonb_build_object('id', lid, 'return_id', rid, 'created_by', p_actor, 'line_no', i,
      'original_line_id', case when l ->> 0 is null then null else md5((l ->> 0) || 'l')::uuid end,
      'product_id', ('a0000000-0000-7000-8000-' || lpad((l ->> 1), 12, '0'))::uuid, 'unit_factor', 1000, 'qty', (l ->> 2)::bigint, 'unit_cost', 0, 'discount', 0, 'net_amount', (l ->> 3)::bigint));
    sm := sm || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', ('a0000000-0000-7000-8000-' || lpad((l ->> 1), 12, '0'))::uuid,
      'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', -(l ->> 2)::bigint, 'unit_cost', 0, 'doc_type', 'purchase_return', 'doc_id', rid, 'line_id', lid, 'occurred_at', now()));
  end loop;
  return pg_temp.row_of('purchase_returns', p_actor, jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', null, 'approved_by', p_approved,
    'supplier_id', p_supplier, 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'subtotal', total, 'discount', 0, 'total', total,
    'lines', ls,
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_return', 'document_id', rid, 'method', 'credit', 'amount', total)),
    'stock_movements', sm,
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', p_supplier, 'amount', total, 'doc_type', 'purchase_return', 'doc_id', rid, 'occurred_at', now())),
    'cash_movements', '[]'::jsonb));
end $$;
create function pg_temp.push(p_actor uuid, p_number text, p_supplier uuid, p_lines jsonb, p_approved uuid default null) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.pret(p_actor, p_number, p_supplier, p_lines, p_approved))));
$$;

insert into suppliers (id, company_id, name) values
  ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1'),
  ('a0000000-0000-7000-8000-000000000502', 'a0000000-0000-7000-8000-000000000001', 'Supplier 2');
-- supplier 1: A1 (product 1, 10 pcs, 50.00) and A2 (product 2, 4 pcs, 40.00) today, O (product 3, 10 pcs, 10.00) 60 days ago; supplier 2: B1 (product 1, 10 pcs, 80.00)
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a1', 'K1-PUR-940001', 'a0000000-0000-7000-8000-000000000501', 1, 10000, 5000, now());
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a2', 'K1-PUR-940002', 'a0000000-0000-7000-8000-000000000501', 2, 4000, 4000, now());
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a3', 'K1-PUR-940003', 'a0000000-0000-7000-8000-000000000501', 3, 10000, 1000, now() - interval '60 days');
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a4', 'K1-PUR-940004', 'a0000000-0000-7000-8000-000000000502', 1, 10000, 8000, now());

select is(purchase_return_default_value('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 3000), 1500::bigint, 'default value = the last price from this supplier (5.00 a piece)');
select is(purchase_return_default_value('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000502', 'a0000000-0000-7000-8000-000000000001', 3000), 2400::bigint, 'another supplier has his own price (8.00)');
select is(purchase_return_default_value('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000004', 2000), 2000::bigint, 'never bought from him: the current cost of the product (10.00)');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940001', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 2000, 1000], ["0190f000-0000-7000-8000-0000000000a2", "2", 1000, 1000]]'), null, 'one return with lines of two invoices of the same supplier is accepted');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940002', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a4", "1", 1000, 800]]'), 'E_VALIDATION', 'a line of another supplier invoice is refused');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940003', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 1000, 999]]'), 'E_VALIDATION', 'the value of an invoice line must match the invoice');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940004', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 9000, 4500]]'), 'E_VALIDATION', 'bought - already returned (10 - 2) caps the quantity');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940005', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 1000, 500], [null, "2", 1000, 1000]]'), 'E_VALIDATION', 'lines with and without an invoice cannot be mixed');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940006', 'a0000000-0000-7000-8000-000000000501',
  '[[null, "1", 2000, 1000]]'), null, 'a storekeeper returns without an invoice at the last price');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940007', 'a0000000-0000-7000-8000-000000000501',
  '[[null, "1", 2000, 1500]]'), 'E_FORBIDDEN', 'but cannot change the value');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-PRT-940008', 'a0000000-0000-7000-8000-000000000501',
  '[[null, "1", 2000, 1500]]'), null, 'a manager can');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d1', 'K1-PRT-940009', 'a0000000-0000-7000-8000-000000000501',
  '[[null, "1", 1000, 500]]'), 'E_FORBIDDEN', 'a cashier cannot return purchases');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940010', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 1000, 500], ["0190f000-0000-7000-8000-0000000000a3", "3", 1000, 100]]'), null, 'an old invoice among the lines needs no approval');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-940011', 'a0000000-0000-7000-8000-000000000501',
  '[["0190f000-0000-7000-8000-0000000000a1", "1", 1000, 500], ["0190f000-0000-7000-8000-0000000000a3", "3", 1000, 100]]', 'a0000000-0000-7000-8000-0000000000d3'), null, 'an approval is harmless');
reset role;
select is((select unit_cost from stock_movements where doc_id = (select id from purchase_returns where number = 'K1-PRT-940006') and doc_type = 'purchase_return'), 500::bigint, 'the goods of a return without invoice leave at the value they are returned for (10.00 for 2 = 5.00 each)');

select * from finish();
rollback;
