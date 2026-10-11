begin;
select plan(8);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;

insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000511', 'a0000000-0000-7000-8000-000000000001', 'مورد اختبار');

-- 10 pieces of product 3 at 10.00 = 100.00, paid: cash from the safe, from the owner's pocket and on credit
create function pg_temp.purchase(p_actor uuid, p_inv uuid, p_number text, safe bigint, owner bigint, credit bigint) returns jsonb language sql as $$
  with v as (select 'a0000000-0000-7000-8000-000000000003'::uuid pid, md5(p_inv::text || 'l')::uuid lid)
  select jsonb_build_object('seq', 1, 'table', 'purchase_invoices', 'op', 'upsert', 'worker_id', p_actor, 'record', jsonb_build_object(
    'id', p_inv, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor,
    'supplier_id', 'a0000000-0000-7000-8000-000000000511', 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1',
    'subtotal', 10000, 'discount', 0, 'total', 10000,
    'lines', jsonb_build_array(jsonb_build_object('id', lid, 'invoice_id', p_inv, 'created_by', p_actor, 'line_no', 1, 'product_id', pid, 'unit_factor', 1000, 'qty', 10000, 'unit_cost', 1000, 'discount', 0, 'net_amount', 10000)),
    'payments', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_invoice', 'document_id', p_inv, 'method', 'cash', 'amount', safe, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13') x where safe > 0
      union all select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_invoice', 'document_id', p_inv, 'method', 'owner', 'amount', owner) where owner > 0
      union all select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'document_type', 'purchase_invoice', 'document_id', p_inv, 'method', 'credit', 'amount', credit) where credit > 0) t),
    'stock_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'product_id', pid, 'warehouse_id', 'a0000000-0000-7000-8000-0000000000c1', 'qty', 10000, 'unit_cost', 0, 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'line_id', lid, 'occurred_at', now())),
    'party_ledger', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000511', 'amount', -credit, 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'occurred_at', now()) x where credit > 0) t),
    'cash_movements', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -safe, 'method', 'cash', 'doc_type', 'purchase_invoice', 'doc_id', p_inv, 'occurred_at', now()) x where safe > 0) t)))
  from v;
$$;
create function pg_temp.supplier_pay(p_actor uuid, p_id uuid, p_number text, amount bigint, method text) returns jsonb language sql as $$
  select jsonb_build_object('seq', 1, 'table', 'supplier_payments', 'op', 'upsert', 'worker_id', p_actor, 'record', jsonb_build_object(
    'id', p_id, 'number', p_number, 'issued_at', now(), 'worker_id', p_actor, 'created_by', p_actor,
    'supplier_id', 'a0000000-0000-7000-8000-000000000511', 'amount', amount, 'method', method,
    'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000511', 'amount', amount, 'doc_type', 'supplier_payment', 'doc_id', p_id, 'occurred_at', now())),
    'cash_movements', case when method = 'cash' then jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'cash_account_id', 'a0000000-0000-7000-8000-000000000a13', 'amount', -amount, 'method', 'cash', 'doc_type', 'supplier_payment', 'doc_id', p_id, 'occurred_at', now())) else '[]'::jsonb end));
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-000000000611', 'K1-PUR-000101', 4000, 3000, 3000)))), null,
  'the manager pays a purchase 40 from the safe, 30 from his pocket and leaves 30 on credit');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.purchase('a0000000-0000-7000-8000-0000000000d2', '0190f000-0000-7000-8000-000000000612', 'K1-PUR-000102', 0, 5000, 5000)))), 'E_FORBIDDEN',
  'a storekeeper cannot pay from the owner''s pocket');
select is(pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(pg_temp.supplier_pay('a0000000-0000-7000-8000-0000000000d3', '0190f000-0000-7000-8000-000000000621', 'K1-PAY-000101', 1000, 'owner')))), null,
  'the manager pays the supplier 10 from his pocket');
reset role;

select is((select sum(amount) from cash_movements where doc_id = '0190f000-0000-7000-8000-000000000611')::bigint, -4000::bigint, 'only the safe part leaves the cash account');
select is((select count(*) from cash_movements where doc_id = '0190f000-0000-7000-8000-000000000621')::int, 0, 'a payment from the owner''s pocket has no cash movement');
select is((select sum(amount) from party_ledger where party_id = 'a0000000-0000-7000-8000-000000000511')::bigint, -2000::bigint, 'we owe 30 credit minus the 10 paid from the pocket; no debt to the owner');

select is(report_purchases_core('a0000000-0000-7000-8000-000000000001', current_date - 1, current_date + 1) -> 'total',
  jsonb_build_object('invoices', 1, 'total', 10000, 'safe', 4000, 'owner', 3000, 'other', 0, 'credit', 3000, 'returns', 0, 'later_owner', 1000, 'later_other', 0),
  'the report splits the purchase by where the money came from');
select is(report_purchases_core('a0000000-0000-7000-8000-000000000001', current_date - 1, current_date + 1) -> 'by_supplier' -> 0 ->> 'supplier', 'مورد اختبار', 'and lists the supplier');

select * from finish();
rollback;
