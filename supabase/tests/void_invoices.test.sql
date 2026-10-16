begin;
select plan(17);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;
create function pg_temp.row_of(p_table text, p_worker uuid, p_rec jsonb) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', p_table, 'op', 'upsert', 'worker_id', p_worker, 'record', p_rec);
$$;
-- a void of an invoice: the negation of its stock, party and cash rows (p_sign = -1 exact); the cash goes on p_acct when given
create function pg_temp.vd(p_actor uuid, p_number text, p_type text, p_target uuid, p_shift uuid, p_sign int default -1, p_acct uuid default null) returns jsonb language sql as $$
  with v as (select gen_random_uuid() vid)
  select pg_temp.row_of('voids', p_actor, jsonb_build_object(
    'id', vid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'shift_id', p_shift,
    'target_type', p_type, 'target_id', p_target, 'reason', 'mistake', 'approved_by', p_actor,
    'stock_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', product_id, 'warehouse_id', warehouse_id, 'qty', qty * p_sign, 'unit_cost', unit_cost, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from stock_movements where doc_id = p_target),
    'party_ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', party_type, 'party_id', party_id, 'amount', amount * p_sign, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from party_ledger where doc_id = p_target),
    'cash_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', coalesce(p_acct, cash_account_id), 'shift_id', p_shift, 'amount', amount * p_sign, 'method', method, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from cash_movements where doc_id = p_target)))
  from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;

-- fixtures (superuser)
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1');
insert into shifts (id, company_id, number, cash_account_id, opened_at, opening_float, status, worker_id) values
  ('0190f000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'K1-SHF-950001', 'a0000000-0000-7000-8000-000000000a11', now(), 10000, 'open', 'a0000000-0000-7000-8000-0000000000d3');
update products set unit_cost = 600 where id = 'a0000000-0000-7000-8000-000000000001';
-- 10 pcs of product 1 were on the shelf at 7.00 before the purchases
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000c1', 10000, 700, 'opening', gen_random_uuid(), now() - interval '2 days');
-- purchase P1: 10 pcs at 5.00 on credit; P2: 2 pcs with a posted return; P3: 5 pcs of product 2 of which 4 were sold
create function pg_temp.purchase(p_id uuid, p_number text, p_product uuid, p_pcs bigint, p_cost bigint) returns void language sql as $$
  insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values
    (p_id, 'a0000000-0000-7000-8000-000000000001', p_number, now() - interval '1 day', 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', p_pcs * p_cost, p_pcs * p_cost);
  insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values
    (md5(p_id::text || 'l')::uuid, 'a0000000-0000-7000-8000-000000000001', p_id, 1, p_product, 1000, p_pcs * 1000, p_cost, p_pcs * p_cost);
  insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, line_id, occurred_at) values
    (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', p_product, 'a0000000-0000-7000-8000-0000000000c1', p_pcs * 1000, p_cost, 'purchase_invoice', p_id, md5(p_id::text || 'l')::uuid, now() - interval '1 day');
  insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values
    (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'supplier', 'a0000000-0000-7000-8000-000000000501', -(p_pcs * p_cost), 'purchase_invoice', p_id, now() - interval '1 day');
$$;
select pg_temp.purchase('0190f000-0000-7000-8000-0000000000a1', 'K1-PUR-950001', 'a0000000-0000-7000-8000-000000000001', 10, 500);
select pg_temp.purchase('0190f000-0000-7000-8000-0000000000a2', 'K1-PUR-950002', 'a0000000-0000-7000-8000-000000000001', 2, 500);
select pg_temp.purchase('0190f000-0000-7000-8000-0000000000a3', 'K1-PUR-950003', 'a0000000-0000-7000-8000-000000000002', 5, 500);
insert into purchase_returns (id, company_id, number, issued_at, supplier_id, total, original_invoice_id) values
  ('0190f000-0000-7000-8000-0000000000a9', 'a0000000-0000-7000-8000-000000000001', 'K1-PRT-950001', now(), 'a0000000-0000-7000-8000-000000000501', 500, '0190f000-0000-7000-8000-0000000000a2');
insert into purchase_return_lines (id, company_id, return_id, line_no, product_id, qty, unit_cost, net_amount, original_line_id) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000a9', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 500, 500, md5('0190f000-0000-7000-8000-0000000000a2' || 'l')::uuid);
-- 4 of the 5 pcs of P3 were sold
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000002', 'a0000000-0000-7000-8000-0000000000c1', -4000, 500, 'sales_invoice', gen_random_uuid(), now());
-- a sales invoice paid 30.00 in cash into the drawer a12 (an older drawer), and a customer credit part
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, customer_id) values
  ('0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-950001', now() - interval '40 days', 3000, 3000, 'a0000000-0000-7000-8000-000000000c01');
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a12', 3000, 'cash', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', now() - interval '40 days');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
-- purchase delete
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d1', 'K1-VOID-950001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', null)), 'E_FORBIDDEN', 'a cashier cannot delete a purchase invoice');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d2', 'K1-VOID-950002', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', null)), 'E_FORBIDDEN', 'a storekeeper cannot either');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950003', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', null, 1)), 'E_VALIDATION', 'rows that are not the exact negation are refused');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950004', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a2', null)), 'E_VALIDATION', 'a purchase with a posted return cannot be deleted');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950005', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a3', null)), 'E_VALIDATION', 'a purchase whose goods were sold cannot be deleted');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950006', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', null)), null, 'the manager deletes the purchase of 10 pcs');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950007', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', null)), 'E_VALIDATION', 'a deleted purchase cannot be deleted again');
reset role;
select is((select status from purchase_invoices where number = 'K1-PUR-950001'), 'voided', 'the purchase is marked voided');
-- 22 pcs on hand at an average of 6.00 (the fixture sets it); without the 10 pcs at 5.00: (22*600 - 10*500) / 12 = 683
select is((select unit_cost from products where id = 'a0000000-0000-7000-8000-000000000001'), 683::bigint, 'the average cost is worked out again without the purchase');
select is((select coalesce(sum(qty), 0)::bigint from stock_movements where doc_id = '0190f000-0000-7000-8000-0000000000a1' or doc_id = (select id from voids where number = 'K1-VOID-950006')), 0::bigint, 'the purchase and its delete leave stock as it was');
select is((select coalesce(sum(amount), 0)::bigint from party_ledger where doc_id = '0190f000-0000-7000-8000-0000000000a1' or doc_id = (select id from voids where number = 'K1-VOID-950006')), 0::bigint, 'and the supplier balance too');

-- sales invoice delete: the cash comes out of the drawer of the open shift
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950008', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', null)), 'E_VALIDATION', 'a cash invoice with no open shift is refused');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950009', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', '0190f000-0000-7000-8000-0000000000b1')), 'E_VALIDATION', 'cash put back on the old drawer instead of the open shift drawer is refused');
select is(pg_temp.push(pg_temp.vd('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-950010', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', '0190f000-0000-7000-8000-0000000000b1', -1, 'a0000000-0000-7000-8000-000000000a11')), null, 'the 40-day-old cash invoice is deleted, its cash leaving the open drawer');
reset role;
select is((select coalesce(sum(amount), 0)::bigint from cash_movements where cash_account_id = 'a0000000-0000-7000-8000-000000000a11' and doc_type = 'void'), -3000::bigint, 'the open drawer lost 30.00');

-- reports
select is((select x ->> 'target_number' from jsonb_array_elements(report_exceptions_core('a0000000-0000-7000-8000-000000000001', current_date - 1, current_date + 1) -> 'voids') x where x ->> 'number' = 'K1-VOID-950006'), 'K1-PUR-950001', 'the exceptions report names the deleted purchase');
select is((select count(*)::int from jsonb_array_elements(report_product_history_core('a0000000-0000-7000-8000-000000000001'::uuid, 'a0000000-0000-7000-8000-000000000001'::uuid, current_date - 3, current_date + 1, 0) -> 'rows') x where x ->> 'doc_type' = 'void_purchase'), 1, 'item history labels it void_purchase');

select * from finish();
rollback;
