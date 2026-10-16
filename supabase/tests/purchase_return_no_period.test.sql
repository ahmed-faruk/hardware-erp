begin;
select plan(5);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;

-- an old purchase: 10 pcs of product 1 at 5.00 on a given day
create function pg_temp.purchase_on(p_inv uuid, p_number text, p_at timestamptz) returns void language sql as $$
  insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values
    (p_inv, 'a0000000-0000-7000-8000-000000000001', p_number, p_at, 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000);
  insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values
    (md5(p_inv::text || 'l')::uuid, 'a0000000-0000-7000-8000-000000000001', p_inv, 1, 'a0000000-0000-7000-8000-000000000001', 1000, 10000, 500, 5000);
$$;
-- a one-line return of 1 pc by invoice (credit refund 5.00), optionally with a manager's approval on the document
create function pg_temp.pret(p_actor uuid, p_number text, p_inv uuid, p_approved uuid default null) returns jsonb language sql as $$
  with ids as (select gen_random_uuid() rid, gen_random_uuid() lid)
  select pg_temp.row_of('purchase_returns', p_actor, jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', p_inv, 'approved_by', p_approved,
    'supplier_id', 'a0000000-0000-7000-8000-000000000501', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'subtotal', 500, 'discount', 0, 'total', 500,
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'return_id', rid, 'created_by', p_actor, 'line_no', 1, 'original_line_id', md5(p_inv::text || 'l')::uuid,
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'unit_factor', 1000, 'qty', 1000, 'unit_cost', 0, 'discount', 0, 'net_amount', 500)),
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_return', 'document_id', rid, 'method', 'credit', 'amount', 500)),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', -1000, 'unit_cost', 0, 'doc_type', 'purchase_return', 'doc_id', rid, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000501', 'amount', 500, 'doc_type', 'purchase_return', 'doc_id', rid, 'occurred_at', now())),
    'cash_movements', '[]'::jsonb))
  from ids;
$$;
create function pg_temp.push(p_actor uuid, p_number text, p_inv uuid, p_approved uuid default null) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.pret(p_actor, p_number, p_inv, p_approved))));
$$;

insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1');
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a1', 'K1-PUR-920001', now() - interval '60 days');
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a2', 'K1-PUR-920002', now());
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a3', 'K1-PUR-920003', now() - interval '1 day');
select pg_temp.purchase_on('0190f000-0000-7000-8000-0000000000a4', 'K1-PUR-920004', now() - interval '60 days');

-- there is no return period: a storekeeper returns any old purchase alone, with no approval
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-920001', '0190f000-0000-7000-8000-0000000000a2'), null, 'today: a storekeeper returns alone');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-920002', '0190f000-0000-7000-8000-0000000000a1'), null, '60 days old: a storekeeper returns alone, no approval');
reset role;
-- an old period setting left in the database is ignored
insert into settings (id, company_id, key, value) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'return.purchaseDays', '0');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-920003', '0190f000-0000-7000-8000-0000000000a3'), null, 'a leftover period of 0 days changes nothing');
select is(pg_temp.push('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-920004', '0190f000-0000-7000-8000-0000000000a4'), null, 'another old purchase, also accepted');
reset role;
select is((select count(*)::int from purchase_returns where number like 'K1-PRT-9200%'), 4, 'all four returns were stored');

select * from finish();
rollback;
