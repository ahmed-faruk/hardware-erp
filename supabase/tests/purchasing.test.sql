begin;
select plan(19);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;

-- fixtures: a supplier
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1');

-- one-line purchase of product p (qty milli, unit cost c, discount d) paid c1 cash from the safe + c2 on credit
create function pg_temp.purchase(p_actor uuid, p_inv uuid, p_number text, p_prod int, q bigint, c bigint, d bigint, cash bigint, credit bigint, net_override bigint default null) returns jsonb language sql as $$
  with v as (select ((q * c + 500) / 1000) gross, ('a0000000-0000-7000-8000-00000000' || lpad(p_prod::text, 4, '0'))::uuid pid, md5(p_inv::text || 'l')::uuid lid)
  select pg_temp.row_of('purchase_invoices', p_actor, jsonb_build_object(
    'id', p_inv, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor,
    'supplier_id', 'a0000000-0000-7000-8000-000000000501', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1',
    'subtotal', gross, 'discount', d, 'total', gross - d,
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'invoice_id', p_inv, 'created_by', p_actor, 'line_no', 1, 'product_id', pid, 'unit_factor', 1000, 'qty', q, 'unit_cost', c, 'discount', d, 'net_amount', coalesce(net_override, gross - d))),
    'payments', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_invoice', 'document_id', p_inv, 'method', 'cash', 'amount', cash, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13') x where cash > 0
      union all select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_invoice', 'document_id', p_inv, 'method', 'credit', 'amount', credit) where credit > 0) t),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', pid, 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', q, 'unit_cost', 0, 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000501', 'amount', -credit, 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'occurred_at', now()) x where credit > 0) t),
    'cash_movements', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -cash, 'method', 'cash', 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'occurred_at', now()) x where cash > 0) t)))
  from v;
$$;

-- moving average parity with src/domain/costing.ts
select is(moving_average(0, 500, 10000, 700), 700::bigint, 'average: no stock before -> the incoming cost');
select is(moving_average(10000, 500, 10000, 700), 600::bigint, 'average of two equal batches');
select is(moving_average(1000, 100, 1000, 101), 101::bigint, 'average rounds half up');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
-- the storekeeper receives 10 pcs of product 1 at 5.00: 20.00 cash, 30.00 on credit
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-000000000501', 'K1-PUR-000001', 1, 10000, 500, 0, 2000, 3000)))), null, 'a storekeeper can receive goods');
reset role;
select is((select unit_cost from products where id = 'a0000000-0000-7000-8000-000000000001'), 500::bigint, 'first purchase sets the cost to the purchase cost');
select is((select unit_cost from stock_movements where doc_id = '0190f000-0000-7000-8000-000000000501'), 500::bigint, 'the movement cost is fixed by the server');
select is((select sum(amount) from party_ledger where party_id = 'a0000000-0000-7000-8000-000000000501')::bigint, -3000::bigint, 'we owe the supplier the credit part');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-000000000502', 'K1-PUR-000002', 1, 10000, 700, 0, 7000, 0))));
reset role;
select is((select unit_cost from products where id = 'a0000000-0000-7000-8000-000000000001'), 600::bigint, 'second purchase moves the average to 6.00');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d1', '0190f000-0000-7000-8000-000000000503', 'K1-PUR-000003', 1, 1000, 500, 0, 500, 0)))), 'E_FORBIDDEN', 'a cashier cannot receive goods');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-000000000504', 'K1-PUR-000004', 1, 1000, 500, 0, 500, 0, 499)))), 'E_VALIDATION', 'a line value that does not match qty x cost is rejected');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-000000000505', 'K1-PUR-000005', 1, 1000, 500, 0, 400, 0)))), 'E_VALIDATION', 'payments must add up to the total');

-- purchase return by invoice: 4 of 10 back at the invoice cost
create function pg_temp.pret(p_actor uuid, p_number text, p_inv uuid, q bigint, net bigint, credit bigint, w uuid default 'a0000000-0000-7000-8000-0000000000c1') returns jsonb language sql as $$
  with ids as (select gen_random_uuid() rid, gen_random_uuid() lid)
  select pg_temp.row_of('purchase_returns', p_actor, jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', p_inv,
    'supplier_id', 'a0000000-0000-7000-8000-000000000501', 'warehouse_id', w, 'subtotal', net, 'discount', 0, 'total', net,
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'return_id', rid, 'created_by', p_actor, 'line_no', 1, 'original_line_id', md5(p_inv::text || 'l')::uuid,
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'unit_factor', 1000, 'qty', q, 'unit_cost', 0, 'discount', 0, 'net_amount', net)),
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_return', 'document_id', rid, 'method', 'credit', 'amount', credit)),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', w, 'qty', -q, 'unit_cost', 0, 'doc_type', 'purchase_return', 'doc_id', rid, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000501', 'amount', credit, 'doc_type', 'purchase_return', 'doc_id', rid, 'occurred_at', now())),
    'cash_movements', '[]'::jsonb))
  from ids;
$$;
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.pret('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-000001', '0190f000-0000-7000-8000-000000000501', 4000, 2000, 2000)))), null, 'a purchase return by invoice is accepted');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.pret('a0000000-0000-7000-8000-0000000000d2', 'K1-PRT-000002', '0190f000-0000-7000-8000-000000000501', 7000, 3500, 3500)))), 'E_VALIDATION', 'cannot return more than bought - already returned');
reset role;
select is((select unit_cost from stock_movements where doc_type = 'purchase_return' limit 1), 500::bigint, 'the return goes out at the invoice cost, not the current average');

-- supplier payment: manager only
create function pg_temp.spay(p_actor uuid, p_number text, amount bigint) returns jsonb language sql as $$
  with v as (select gen_random_uuid() pid)
  select pg_temp.row_of('supplier_payments', p_actor, jsonb_build_object('id', pid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor,
    'supplier_id', 'a0000000-0000-7000-8000-000000000501', 'amount', amount, 'method', 'cash',
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000501', 'amount', amount, 'doc_type', 'supplier_payment', 'doc_id', pid, 'occurred_at', now())),
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -amount, 'method', 'cash', 'doc_type', 'supplier_payment', 'doc_id', pid, 'occurred_at', now())))) from v;
$$;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.spay('a0000000-0000-7000-8000-0000000000d2', 'K1-PAY-000001', 1000)))), 'E_FORBIDDEN', 'a storekeeper cannot pay a supplier');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.spay('a0000000-0000-7000-8000-0000000000d3', 'K1-PAY-000002', 1000)))), null, 'the manager can');

-- stock adjustment
create function pg_temp.adj(p_actor uuid, p_number text, reason text, delta bigint, approved uuid default null) returns jsonb language sql as $$
  with v as (select gen_random_uuid() aid)
  select pg_temp.row_of('stock_adjustments', p_actor, jsonb_build_object('id', aid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor,
    'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'reason_code', reason, 'approved_by', approved,
    'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'adjustment_id', aid, 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'qty_delta', delta, 'unit_cost', 0)),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', delta, 'unit_cost', 0, 'doc_type', 'stock_adjustment', 'doc_id', aid, 'occurred_at', now())))) from v;
$$;
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.adj('a0000000-0000-7000-8000-0000000000d2', 'K1-ADJ-000001', 'lost', -1000)))), null, 'a small adjustment by the storekeeper is accepted');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.adj('a0000000-0000-7000-8000-0000000000d2', 'K1-ADJ-000002', 'lost', -200000)))), 'E_FORBIDDEN', 'a big one needs a manager approval');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.adj('a0000000-0000-7000-8000-0000000000d2', 'K1-ADJ-000003', 'found', -1000)))), 'E_VALIDATION', 'the quantity must fit the reason');
reset role;

select * from finish();
rollback;
