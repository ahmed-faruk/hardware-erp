begin;
select plan(9);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;

-- one line of a free return
create function pg_temp.fline(p_rid uuid, p_actor uuid, p_product int, p_qty bigint, p_net bigint) returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'return_id', p_rid, 'created_by', p_actor, 'original_line_id', null,
    'product_id', ('a0000000-0000-7000-8000-' || lpad(p_product::text, 12, '0'))::uuid, 'qty', p_qty, 'unit_refund', p_net, 'net_amount', p_net, 'unit_cost', 0,
    'condition', 'good', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1');
$$;
-- a manager's return without invoice with one or two or three lines: (product, qty, net) triples
create function pg_temp.free_return(p_actor uuid, p_number text, p_lines jsonb) returns jsonb language plpgsql as $$
declare
  rid uuid := gen_random_uuid();
  ls jsonb := '[]';
  sm jsonb := '[]';
  total bigint := 0;
  l jsonb;
  built jsonb;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    built := pg_temp.fline(rid, p_actor, (l ->> 0)::int, (l ->> 1)::bigint, (l ->> 2)::bigint);
    ls := ls || jsonb_build_array(built);
    total := total + (l ->> 2)::bigint;
    sm := sm || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', built ->> 'product_id',
      'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', (l ->> 1)::bigint, 'unit_cost', 0, 'doc_type', 'sales_return', 'doc_id', rid,
      'line_id', built ->> 'id', 'occurred_at', now()));
  end loop;
  return jsonb_build_object('seq', 1, 'table', 'sales_returns', 'op', 'upsert', 'worker_id', p_actor, 'record', jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', null, 'customer_id', null,
    'total', total, 'refund_method', 'cash', 'lines', ls,
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'sales_return', 'document_id', rid, 'method', 'cash', 'amount', total)),
    'stock_movements', sm, 'party_ledger', '[]'::jsonb,
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11',
      'amount', -total, 'method', 'cash', 'doc_type', 'sales_return', 'doc_id', rid, 'occurred_at', now()))));
end $$;
create function pg_temp.push(p_actor uuid, p_number text, p_lines jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.free_return(p_actor, p_number, p_lines))));
$$;

-- fixtures (superuser): product 1 sold x3, product 2 sold x2 on a posted invoice, 1 of product 1 already returned by invoice;
-- product 4 only sold on a voided invoice; product 3 never sold
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal) values
  ('0190f000-0000-7000-8000-0000000000f1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000950', now(), 7000, 7000);
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status) values
  ('0190f000-0000-7000-8000-0000000000f2', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000951', now(), 1000, 1000, 'voided');
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values
  ('0190f000-0000-7000-8000-0000000001a1', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000f1', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 3000, 1000, 3000, 700),
  ('0190f000-0000-7000-8000-0000000001a2', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000f1', 2, 'a0000000-0000-7000-8000-000000000002', 1000, 2000, 2000, 4000, 800),
  ('0190f000-0000-7000-8000-0000000001a3', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000f2', 1, 'a0000000-0000-7000-8000-000000000004', 1000, 1000, 1000, 1000, 600);
insert into sales_returns (id, company_id, number, issued_at, total, refund_method, original_invoice_id) values
  ('0190f000-0000-7000-8000-0000000000f3', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-000950', now(), 1000, 'cash', '0190f000-0000-7000-8000-0000000000f1');
insert into sales_return_lines (id, company_id, return_id, original_line_id, product_id, qty, unit_refund, net_amount, unit_cost, condition, warehouse_id) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000f3', '0190f000-0000-7000-8000-0000000001a1', 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 1000, 700, 'good', 'a0000000-0000-7000-8000-0000000000c1');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d1', 'K1-RET-000960', '[[1, 1000, 1000]]'), 'E_FORBIDDEN', 'D9 a cashier still cannot return without an invoice');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000961', '[[3, 1000, 1500]]'), 'E_VALIDATION', 'D3 a product that was never sold is refused');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000962', '[[4, 1000, 1000]]'), 'E_VALIDATION', 'D3 a product sold only on a voided invoice is refused');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000963', '[[1, 2500, 2500]]'), 'E_VALIDATION', 'D4 more than sold minus already returned (3 - 1 = 2) is refused');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000964', '[[1, 1500, 1500], [1, 1000, 1000]]'), 'E_VALIDATION', 'D4 two lines of one product together may not pass the limit');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000965', '[[1, 1000, 1000], [2, 2000, 4000]]'), null, 'D2 two sold products in one return are accepted');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000966', '[[1, 1500, 1500]]'), 'E_VALIDATION', 'D4 and the next return sees what the first one took (1 left of product 1)');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-000967', '[[1, 1000, 1000]]'), null, 'the last unit can still be returned');
reset role;
select is((select count(*)::int from sales_return_lines where return_id in (select id from sales_returns where number = 'K1-RET-000965')), 2, 'the accepted document has both lines');

select * from finish();
rollback;
