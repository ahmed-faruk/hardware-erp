begin;
select plan(16);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;

-- original sale on the manager device K1: product 1 x3 @10.00 and product 2 x2 @20.00 = 70.00 (50.00 cash + 20.00 credit to customer c01)
create function pg_temp.sale(p_inv uuid, p_number text) returns jsonb language sql as $$
  select pg_temp.row_of('sales_invoices', 'a0000000-0000-7000-8000-0000000000d3', jsonb_build_object(
    'id', p_inv, 'number', p_number, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d3',
    'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'customer_id', 'a0000000-0000-7000-8000-000000000c01',
    'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'subtotal', 7000, 'total', 7000,
    'lines', jsonb_build_array(
      jsonb_build_object('id', md5(p_inv::text || 'a')::uuid, 'invoice_id', p_inv, 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'line_no', 1,
        'product_id', 'a0000000-0000-7000-8000-000000000001', 'unit_factor', 1000, 'qty', 3000, 'unit_price', 1000, 'net_amount', 3000, 'unit_cost', 700),
      jsonb_build_object('id', md5(p_inv::text || 'b')::uuid, 'invoice_id', p_inv, 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'line_no', 2,
        'product_id', 'a0000000-0000-7000-8000-000000000002', 'unit_factor', 1000, 'qty', 2000, 'unit_price', 2000, 'net_amount', 4000, 'unit_cost', 800)),
    'payments', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'document_type', 'sales_invoice', 'document_id', p_inv, 'method', 'cash', 'amount', 5000, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11'),
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'document_type', 'sales_invoice', 'document_id', p_inv, 'method', 'credit', 'amount', 2000)),
    'stock_movements', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', -3000, 'unit_cost', 700, 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'line_id', md5(p_inv::text || 'a')::uuid, 'occurred_at', now()),
      jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'product_id', 'a0000000-0000-7000-8000-000000000002', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', -2000, 'unit_cost', 800, 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'line_id', md5(p_inv::text || 'b')::uuid, 'occurred_at', now())),
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'party_type', 'customer', 'party_id', 'a0000000-0000-7000-8000-000000000c01', 'amount', 2000, 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'occurred_at', now())),
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'amount', 5000, 'method', 'cash', 'doc_type', 'sales_invoice', 'doc_id', p_inv, 'occurred_at', now()))));
$$;

-- a one-line return of line 'a' of invoice p_inv: qty q (units), refund net, cash part c, credit part d, warehouse w
create function pg_temp.ret(p_actor uuid, p_number text, p_inv uuid, q bigint, net bigint, c bigint, d bigint, w uuid, cond text default 'good', approved uuid default null, client_cost bigint default 0) returns jsonb language sql as $$
  with ids as (select gen_random_uuid() rid, gen_random_uuid() lid)
  select pg_temp.row_of('sales_returns', p_actor, jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', p_inv,
    'customer_id', 'a0000000-0000-7000-8000-000000000c01', 'total', net, 'refund_method', 'cash', 'approved_by', approved,
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'return_id', rid, 'created_by', p_actor, 'original_line_id', md5(p_inv::text || 'a')::uuid,
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'qty', q, 'unit_refund', net, 'net_amount', net, 'unit_cost', client_cost, 'condition', cond, 'warehouse_id', w)),
    'payments', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'sales_return', 'document_id', rid, 'method', 'cash', 'amount', c) x where c > 0
      union all select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'sales_return', 'document_id', rid, 'method', 'credit', 'amount', d) where d > 0) t),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', w, 'qty', q, 'unit_cost', client_cost, 'doc_type', 'sales_return', 'doc_id', rid, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'customer', 'party_id', 'a0000000-0000-7000-8000-000000000c01', 'amount', -d, 'doc_type', 'sales_return', 'doc_id', rid, 'occurred_at', now()) x where d > 0) t),
    'cash_movements', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'amount', -c, 'method', 'cash', 'doc_type', 'sales_return', 'doc_id', rid, 'occurred_at', now()) x where c > 0) t)))
  from ids;
$$;

-- fixtures as the superuser (the seed has the scrap warehouse): an old invoice (60 days ago) with a line
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal) values ('0190f000-0000-7000-8000-0000000000e0', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000900', now() - interval '60 days', 1000, 1000);
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost)
values (md5('0190f000-0000-7000-8000-0000000000e0a')::uuid, 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000e0', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 1000, 1000, 650);

-- the original sale (manager device K1)
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.sale('0190f000-0000-7000-8000-0000000000e1', 'K1-INV-000901')))), null, 'original sale accepted');
reset role;

-- a cashier (phone M1) returns 1 of 3 units of line a: refund 10.00 = 7.14 cash + 2.86 off the debt (the invoice was 50 cash + 20 credit)
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000001', '0190f000-0000-7000-8000-0000000000e1', 1000, 1000, 714, 286, 'a0000000-0000-7000-8000-0000000000c1')))), null, 'a cashier can return by invoice');
reset role;
select is((select unit_cost from stock_movements where doc_type = 'sales_return' and qty = 1000 limit 1), 700::bigint, 'the return cost comes from the original line, not from the client');
select is((select sum(amount)::bigint from party_ledger where party_id = 'a0000000-0000-7000-8000-000000000c01' and (doc_id = '0190f000-0000-7000-8000-0000000000e1' or doc_type = 'sales_return')), 1714::bigint, 'the credit part of the refund reduces the customer debt (20.00 - 2.86)');

-- over-return: 2 units are left, 3 requested
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000002', '0190f000-0000-7000-8000-0000000000e1', 3000, 3000, 3000, 0, 'a0000000-0000-7000-8000-0000000000c1')))), 'E_VALIDATION', 'cannot return more than sold - already returned');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000003', '0190f000-0000-7000-8000-0000000000e1', 1000, 999, 999, 0, 'a0000000-0000-7000-8000-0000000000c1')))), 'E_VALIDATION', 'a refund that is not the invoice share is rejected');
-- good goods must go to the main warehouse, damaged to scrap
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000004', '0190f000-0000-7000-8000-0000000000e1', 1000, 1000, 714, 286, 'a0000000-0000-7000-8000-0000000000c2')))), 'E_VALIDATION', 'good goods cannot go to the scrap warehouse');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000005', '0190f000-0000-7000-8000-0000000000e1', 1000, 1000, 714, 286, 'a0000000-0000-7000-8000-0000000000c2', 'damaged')))), null, 'damaged goods go to scrap');
-- a return after the period needs a manager approval
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000006', '0190f000-0000-7000-8000-0000000000e0', 1000, 1000, 1000, 0, 'a0000000-0000-7000-8000-0000000000c1')))), 'E_FORBIDDEN', 'after the return period a cashier needs the manager');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f3', '0', jsonb_build_array(pg_temp.ret('a0000000-0000-7000-8000-0000000000d1', 'M1-RET-000007', '0190f000-0000-7000-8000-0000000000e0', 1000, 1000, 1000, 0, 'a0000000-0000-7000-8000-0000000000c1', 'good', 'a0000000-0000-7000-8000-0000000000d3')))), null, 'with a manager approval it is accepted');
reset role;

-- void: manager only, exact reversal, once, and never after a return
create function pg_temp.void(p_actor uuid, p_number text, p_inv uuid, p_sign int default -1) returns jsonb language sql as $$
  with v as (select gen_random_uuid() vid)
  select pg_temp.row_of('voids', p_actor, jsonb_build_object(
    'id', vid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'target_type', 'sales_invoice', 'target_id', p_inv, 'reason', 'x',
    'stock_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', product_id, 'warehouse_id', warehouse_id, 'qty', -qty * p_sign * -1, 'unit_cost', unit_cost, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]') from stock_movements where doc_id = p_inv),
    'party_ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', party_type, 'party_id', party_id, 'amount', -amount, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]') from party_ledger where doc_id = p_inv),
    'cash_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', cash_account_id, 'amount', -amount, 'method', method, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]') from cash_movements where doc_id = p_inv)))
  from v;
$$;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.sale('0190f000-0000-7000-8000-0000000000e2', 'K1-INV-000902')));
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.void('a0000000-0000-7000-8000-0000000000d1', 'K1-VOID-000001', '0190f000-0000-7000-8000-0000000000e2')))), 'E_FORBIDDEN', 'a cashier cannot void');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.void('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-000002', '0190f000-0000-7000-8000-0000000000e1')))), 'E_VALIDATION', 'an invoice with a return cannot be voided');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.void('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-000003', '0190f000-0000-7000-8000-0000000000e2')))), null, 'the manager can void');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.void('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-000004', '0190f000-0000-7000-8000-0000000000e2')))), 'E_VALIDATION', 'and only once');
reset role;
select is((select status from sales_invoices where id = '0190f000-0000-7000-8000-0000000000e2'), 'voided', 'the invoice is marked voided');
select is(((select coalesce(sum(qty), 0) from stock_movements where doc_id = '0190f000-0000-7000-8000-0000000000e2') + (select coalesce(sum(qty), 0) from stock_movements where doc_type = 'void'))::bigint, 0::bigint, 'the void leaves stock exactly as before the sale');

select * from finish();
rollback;
