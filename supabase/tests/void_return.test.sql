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

-- a void of a sales return: the exact negation of the stock, party and cash rows of the return (sign = -1 is exact, 1 is wrong)
create function pg_temp.void_return(p_actor uuid, p_number text, p_ret uuid, p_shift uuid, p_sign int default -1) returns jsonb language sql as $$
  with v as (select gen_random_uuid() vid)
  select pg_temp.row_of('voids', p_actor, jsonb_build_object(
    'id', vid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'shift_id', p_shift,
    'target_type', 'sales_return', 'target_id', p_ret, 'reason', 'mistake', 'approved_by', p_actor,
    'stock_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', product_id, 'warehouse_id', warehouse_id, 'qty', qty * p_sign, 'unit_cost', unit_cost, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from stock_movements where doc_id = p_ret),
    'party_ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', party_type, 'party_id', party_id, 'amount', amount * p_sign, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from party_ledger where doc_id = p_ret),
    'cash_movements', (select coalesce(jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', cash_account_id, 'shift_id', p_shift, 'amount', amount * p_sign, 'method', method, 'doc_type', 'void', 'doc_id', vid, 'occurred_at', now())), '[]'::jsonb) from cash_movements where doc_id = p_ret)))
  from v;
$$;
create function pg_temp.push(p_row jsonb) returns text language sql as $$
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(p_row)));
$$;
-- a by-invoice return of p_qty units of line 'a' of an invoice, refund in cash from the drawer
create function pg_temp.ret(p_actor uuid, p_number text, p_inv uuid, p_qty bigint, p_net bigint, p_shift uuid) returns jsonb language sql as $$
  with ids as (select gen_random_uuid() rid, gen_random_uuid() lid)
  select pg_temp.row_of('sales_returns', p_actor, jsonb_build_object(
    'id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor, 'original_invoice_id', p_inv, 'total', p_net, 'refund_method', 'cash',
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'return_id', rid, 'created_by', p_actor, 'original_line_id', md5(p_inv::text || 'a')::uuid,
      'product_id', 'a0000000-0000-7000-8000-000000000001', 'qty', p_qty, 'unit_refund', p_net, 'net_amount', p_net, 'unit_cost', 0, 'condition', 'good', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1')),
    'payments', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'sales_return', 'document_id', rid, 'method', 'cash', 'amount', p_net)),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', 'a0000000-0000-7000-8000-000000000001', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', p_qty, 'unit_cost', 0, 'doc_type', 'sales_return', 'doc_id', rid, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', '[]'::jsonb,
    'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'shift_id', p_shift, 'amount', -p_net, 'method', 'cash', 'doc_type', 'sales_return', 'doc_id', rid, 'occurred_at', now())))) from ids;
$$;

-- fixtures (superuser): an open shift on drawer a11, two invoices (3 pcs of product 1 each) and a posted return of 1 pc on each
insert into shifts (id, company_id, number, cash_account_id, opened_at, opening_float, status, worker_id) values
  ('0190f000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'K1-SHF-930001', 'a0000000-0000-7000-8000-000000000a11', now(), 10000, 'open', 'a0000000-0000-7000-8000-0000000000d3'),
  ('0190f000-0000-7000-8000-0000000000b2', 'a0000000-0000-7000-8000-000000000001', 'K1-SHF-930002', 'a0000000-0000-7000-8000-000000000a12', now(), 0, 'closed', 'a0000000-0000-7000-8000-0000000000d3');
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, customer_id) values
  ('0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-930001', now(), 3000, 3000, 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-0000000000c2', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-930002', now(), 3000, 3000, 'a0000000-0000-7000-8000-000000000c01');
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values
  (md5('0190f000-0000-7000-8000-0000000000c1a')::uuid, 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000c1', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 3000, 1000, 3000, 700),
  (md5('0190f000-0000-7000-8000-0000000000c2a')::uuid, 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000c2', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 3000, 1000, 3000, 700);

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.ret('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-930001', '0190f000-0000-7000-8000-0000000000c1', 1000, 1000, '0190f000-0000-7000-8000-0000000000b1')), null, 'return 1 (1 pc, 10.00 cash) accepted');
select is(pg_temp.push(pg_temp.ret('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-930002', '0190f000-0000-7000-8000-0000000000c2', 1000, 1000, '0190f000-0000-7000-8000-0000000000b1')), null, 'return 2 accepted');
reset role;
-- ids of the two returns
create temp table r on commit drop as select number, id from sales_returns where number in ('K1-RET-930001', 'K1-RET-930002');
grant select on r to authenticated;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d1', 'K1-VOID-930001', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b1')), 'E_FORBIDDEN', 'a cashier cannot void a return');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d2', 'K1-VOID-930002', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b1')), 'E_FORBIDDEN', 'a storekeeper cannot either');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-930003', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b1', 1)), 'E_VALIDATION', 'rows that are not the exact negation are refused');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-930004', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b2')), 'E_VALIDATION', 'the cash must go back into an OPEN shift of the same drawer (a closed shift of another drawer is refused)');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-930005', (select id from r where number = 'K1-RET-930001'), null)), 'E_VALIDATION', 'a cash refund with no shift is refused');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-930006', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b1')), null, 'the manager voids return 1');
select is(pg_temp.push(pg_temp.void_return('a0000000-0000-7000-8000-0000000000d3', 'K1-VOID-930007', (select id from r where number = 'K1-RET-930001'), '0190f000-0000-7000-8000-0000000000b1')), 'E_VALIDATION', 'a voided return cannot be voided again');
-- invoice 2 still has a posted return: it cannot be voided; invoice 1 can (its only return is voided)
select is(pg_temp.push(pg_temp.row_of('voids', 'a0000000-0000-7000-8000-0000000000d3', jsonb_build_object('id', gen_random_uuid(), 'number', 'K1-VOID-930008', 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d3', 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'target_type', 'sales_invoice', 'target_id', '0190f000-0000-7000-8000-0000000000c2', 'reason', 'x', 'stock_movements', '[]'::jsonb, 'party_ledger', '[]'::jsonb, 'cash_movements', '[]'::jsonb))), 'E_VALIDATION', 'an invoice with a posted return still cannot be voided');
reset role;
select is((select status from sales_returns where number = 'K1-RET-930001'), 'voided', 'the return is marked voided');
select is((select coalesce(sum(qty), 0)::bigint from stock_movements where doc_id = (select id from r where number = 'K1-RET-930001') or doc_id = (select id from voids where target_id = (select id from r where number = 'K1-RET-930001'))), 0::bigint, 'the return and its void leave stock exactly as it was');
select is((select coalesce(sum(amount), 0)::bigint from cash_movements where doc_id = (select id from r where number = 'K1-RET-930001') or doc_id = (select id from voids where target_id = (select id from r where number = 'K1-RET-930001'))), 0::bigint, 'and the drawer too');

-- invoice 1 is returnable in full again (3 pcs), and invoice 1 can now be voided
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.push(pg_temp.ret('a0000000-0000-7000-8000-0000000000d3', 'K1-RET-930003', '0190f000-0000-7000-8000-0000000000c1', 3000, 3000, '0190f000-0000-7000-8000-0000000000b1')), null, 'all 3 pcs of invoice 1 can be returned again after the void');
reset role;

-- the item history shows the void of a return as such
select is((select count(*)::int from jsonb_array_elements(report_product_history_core('a0000000-0000-7000-8000-000000000001'::uuid, 'a0000000-0000-7000-8000-000000000001'::uuid, current_date - 1, current_date + 1, 0) -> 'rows') x where x ->> 'doc_type' = 'void_return'), 1, 'item history labels it void_return');

select * from finish();
rollback;
