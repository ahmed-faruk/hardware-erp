begin;
select plan(9);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(p_batch jsonb) returns text language sql as $$ select p_batch -> 'data' -> 'rejected' -> 0 ->> 'code' $$;

-- fixtures: an invoice with 20.00 on credit for the customer, one for another customer, and a purchase invoice with 30.00 on credit
insert into customers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000c02', 'a0000000-0000-7000-8000-000000000001', 'Other');
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'S1');
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, customer_id) values
  ('0190f000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000801', now(), 2000, 2000, 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-0000000000d2', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000802', now(), 1000, 1000, 'a0000000-0000-7000-8000-000000000c02');
insert into payments (id, company_id, document_type, document_id, method, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000d1', 'credit', 2000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000d2', 'credit', 1000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000e1', 'credit', 3000);
insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, total, subtotal) values
  ('0190f000-0000-7000-8000-0000000000e1', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-000801', now(), 'a0000000-0000-7000-8000-000000000501', 3000, 3000);

create function pg_temp.receipt(p_number text, p_amount bigint, p_alloc jsonb) returns text language sql as $$
  with v as (select gen_random_uuid() rid)
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'customer_receipts', 'op', 'upsert', 'worker_id', 'a0000000-0000-7000-8000-0000000000d3',
    'record', jsonb_build_object('id', rid, 'number', p_number, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d3', 'created_by', 'a0000000-0000-7000-8000-0000000000d3',
      'customer_id', 'a0000000-0000-7000-8000-000000000c01', 'amount', p_amount, 'method', 'cash', 'allocations', p_alloc,
      'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'party_type', 'customer', 'party_id', 'a0000000-0000-7000-8000-000000000c01', 'amount', -p_amount, 'doc_type', 'customer_receipt', 'doc_id', rid, 'occurred_at', now())),
      'cash_movements', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'cash_account_id', 'a0000000-0000-7000-8000-000000000a11', 'amount', p_amount, 'method', 'cash', 'doc_type', 'customer_receipt', 'doc_id', rid, 'occurred_at', now())))))))
  from v;
$$;
create function pg_temp.spay(p_number text, p_amount bigint, p_alloc jsonb) returns text language sql as $$
  with v as (select gen_random_uuid() pid)
  select pg_temp.code(ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0', jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'supplier_payments', 'op', 'upsert', 'worker_id', 'a0000000-0000-7000-8000-0000000000d3',
    'record', jsonb_build_object('id', pid, 'number', p_number, 'issued_at', now(), 'worker_id', 'a0000000-0000-7000-8000-0000000000d3', 'created_by', 'a0000000-0000-7000-8000-0000000000d3',
      'supplier_id', 'a0000000-0000-7000-8000-000000000501', 'amount', p_amount, 'method', 'other', 'reference', 'x', 'allocations', p_alloc,
      'party_ledger', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d3', 'party_type', 'supplier', 'party_id', 'a0000000-0000-7000-8000-000000000501', 'amount', p_amount, 'doc_type', 'supplier_payment', 'doc_id', pid, 'occurred_at', now())),
      'cash_movements', '[]'::jsonb))))) from v;
$$;

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.receipt('K1-RCV-000801', 1500, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d1","amount":1500}]'), null, 'a collection can settle part of an invoice');
select is(pg_temp.receipt('K1-RCV-000802', 600, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d1","amount":600}]'), 'E_VALIDATION', 'but not more than what is still open (5.00 left)');
select is(pg_temp.receipt('K1-RCV-000803', 500, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d1","amount":500}]'), null, 'exactly the open amount is fine');
select is(pg_temp.receipt('K1-RCV-000804', 100, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d1","amount":150}]'), 'E_VALIDATION', 'allocations above the receipt amount are refused');
select is(pg_temp.receipt('K1-RCV-000805', 100, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d2","amount":100}]'), 'E_VALIDATION', 'an invoice of another customer is refused');
select is(pg_temp.receipt('K1-RCV-000806', 100, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000d1","amount":0}]'), 'E_VALIDATION', 'a zero allocation is refused');
select is(pg_temp.receipt('K1-RCV-000807', 100, null), null, 'no allocations = on account, as before');
select is(pg_temp.spay('K1-PAY-000801', 3000, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000e1","amount":3000}]'), null, 'a supplier payment settles a purchase invoice');
select is(pg_temp.spay('K1-PAY-000802', 100, '[{"invoice_id":"0190f000-0000-7000-8000-0000000000e1","amount":100}]'), 'E_VALIDATION', 'and it is then fully settled');
reset role;

select * from finish();
rollback;
