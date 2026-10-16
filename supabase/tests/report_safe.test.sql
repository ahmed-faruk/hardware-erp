begin;
select plan(24);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.r() returns jsonb language sql as $$
  select report_safe_core('a0000000-0000-7000-8000-000000000001', current_date - 2, current_date + 1)
$$;
-- the amount of one line (0 when the line is not there)
create function pg_temp.line(p_group text, p_key text) returns bigint language sql as $$
  select coalesce((select (x ->> 'amount')::bigint from jsonb_array_elements(pg_temp.r() -> p_group) x where x ->> 'key' = p_key), 0)
$$;

insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1');
-- cash movements of the period (money out is stored negative)
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', 10000, 'cash', 'sales_invoice', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', 2000, 'cash', 'customer_receipt', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -1500, 'cash', 'purchase_invoice', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -700, 'cash', 'supplier_payment', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', -300, 'cash', 'expense', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -1000, 'cash', 'payroll', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', -400, 'cash', 'sales_return', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', 250, 'cash', 'purchase_return', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', 500, 'cash', 'cash_adjustment', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -100, 'cash', 'cash_adjustment', gen_random_uuid(), now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', -999, 'cash', 'void', gen_random_uuid(), now()),
  -- a transfer between accounts is not money in or out
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', -5000, 'cash', 'cash_transfer', '0190f000-0000-7000-8000-0000000000f9', now()),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', 5000, 'cash', 'cash_transfer', '0190f000-0000-7000-8000-0000000000f9', now()),
  -- outside the period
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a11', 7777, 'cash', 'sales_invoice', gen_random_uuid(), now() - interval '10 days');
-- a bank account also counts in cash now (one box)
insert into cash_accounts (id, company_id, name, kind) values ('0190f000-0000-7000-8000-0000000000ba', 'a0000000-0000-7000-8000-000000000001', 'Bank', 'bank');
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000ba', 1000, 'cash', 'cash_transfer', gen_random_uuid(), now());
-- sales invoices: a card sale 30.00 and an InstaPay sale 20.00 (posted), a voided card sale, an old one
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status) values
  ('0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960001', now(), 3000, 3000, 'posted'),
  ('0190f000-0000-7000-8000-0000000000c2', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960002', now(), 2000, 2000, 'posted'),
  ('0190f000-0000-7000-8000-0000000000c3', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960003', now(), 8000, 8000, 'voided'),
  ('0190f000-0000-7000-8000-0000000000c4', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960004', now() - interval '10 days', 9000, 9000, 'posted'),
  ('0190f000-0000-7000-8000-0000000000c5', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960005', now(), 1200, 1200, 'posted');
insert into payments (id, company_id, document_type, document_id, method, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', 'card', 3000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c2', 'instapay', 2000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c3', 'card', 8000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c4', 'card', 9000),
  -- a credit sale is not money
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c5', 'credit', 1200);
-- customer receipts: 15.00 by InstaPay (counts), 10.00 cash (its ledger row is counted above, not here)
insert into customer_receipts (id, company_id, number, issued_at, customer_id, amount, method) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RCV-960001', now(), 'a0000000-0000-7000-8000-000000000c01', 1500, 'instapay'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RCV-960002', now(), 'a0000000-0000-7000-8000-000000000c01', 1000, 'cash');
-- purchases: a card purchase 40.00 (counts), a credit one (not money), an owner-paid one 60.00 (note only)
insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values
  ('0190f000-0000-7000-8000-0000000000a1', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960001', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 4000, 4000),
  ('0190f000-0000-7000-8000-0000000000a2', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960002', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000),
  ('0190f000-0000-7000-8000-0000000000a3', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960003', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 6000, 6000);
insert into payments (id, company_id, document_type, document_id, method, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', 'card', 4000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a2', 'credit', 5000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a3', 'owner', 6000);
-- supplier payments: 25.00 by wallet (counts), 35.00 from the owner's pocket (note only)
insert into supplier_payments (id, company_id, number, issued_at, supplier_id, amount, method) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-PAY-960001', now(), 'a0000000-0000-7000-8000-000000000501', 2500, 'wallet'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-PAY-960002', now(), 'a0000000-0000-7000-8000-000000000501', 3500, 'owner');
-- the old system
insert into legacy_sales (company_id, id, kind, day, total, cash, card, other, credit) values
  ('a0000000-0000-7000-8000-000000000001', 970001, 0, current_date, 5000, 3000, 1500, 500, 0),
  ('a0000000-0000-7000-8000-000000000001', 970002, 1, current_date, 800, 800, 0, 0, 0),
  ('a0000000-0000-7000-8000-000000000001', 970003, 0, current_date - 30, 99999, 99999, 0, 0, 0);
insert into legacy_purchases (company_id, id, kind, day, total, cash, credit, other) values
  ('a0000000-0000-7000-8000-000000000001', 971001, 0, current_date, 2000, 1200, 800, 0),
  ('a0000000-0000-7000-8000-000000000001', 971002, 1, current_date, 300, 300, 0, 0);
-- today: a posted sales return 12.00, and the voided invoice above (voids row)
insert into sales_returns (id, company_id, number, issued_at, total, refund_method, original_invoice_id) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RET-960001', now(), 1200, 'cash', '0190f000-0000-7000-8000-0000000000c4');
insert into voids (id, company_id, number, issued_at, target_type, target_id, reason) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-VOID-960001', now(), 'sales_invoice', '0190f000-0000-7000-8000-0000000000c3', 'mistake');

-- money in
select is(pg_temp.line('in', 'cash_sales'), 13000::bigint, 'cash sales: the ledger 100.00 plus the old system 30.00; the old one outside the period is not counted');
select is(pg_temp.line('in', 'cash_receipts'), 2000::bigint, 'cash collections come from the ledger');
select is(pg_temp.line('in', 'card_sales'), 4500::bigint, 'card sales: 30.00 posted + 15.00 old; a voided invoice and an old one drop out');
select is(pg_temp.line('in', 'instapay_sales'), 2000::bigint, 'InstaPay sales');
select is(pg_temp.line('in', 'other_sales'), 500::bigint, 'old system other');
select is(pg_temp.line('in', 'noncash_receipts'), 1500::bigint, 'a non-cash collection counts, a cash receipt row is not counted twice');
select is(pg_temp.line('in', 'cash_purchase_returns'), 550::bigint, 'purchase return cash back: ledger 2.50 + old 3.00');
-- money out
select is(pg_temp.line('out', 'cash_purchases'), 2700::bigint, 'cash purchases: ledger 15.00 + old 12.00 + other 0');
select is(pg_temp.line('out', 'cash_supplier_payments'), 700::bigint, 'supplier payments in cash');
select is(pg_temp.line('out', 'expenses'), 300::bigint, 'expenses');
select is(pg_temp.line('out', 'payroll'), 1000::bigint, 'payroll');
select is(pg_temp.line('out', 'cash_sales_returns'), 1200::bigint, 'cash sales returns: ledger 4.00 + old 8.00');
select is(pg_temp.line('out', 'noncash_purchases'), 4000::bigint, 'a card purchase counts; credit and owner-paid do not');
select is(pg_temp.line('out', 'noncash_supplier_payments'), 2500::bigint, 'a wallet supplier payment counts; the owner one does not');
-- adjustments and the note
select is(pg_temp.line('adjust', 'cash_adjustments'), 400::bigint, 'adjustments carry their sign');
select is(pg_temp.line('adjust', 'voids'), -999::bigint, 'deletes carry their sign');
select is((pg_temp.r() ->> 'owner_paid')::bigint, 9500::bigint, 'owner-paid money is only a note: 60.00 purchase + 35.00 supplier payment');
select is((pg_temp.r() ->> 'legacy_count')::int, 4, 'old-system documents in the period are counted');
select is(
  (pg_temp.r() ->> 'net')::bigint,
  (pg_temp.r() ->> 'total_in')::bigint - (pg_temp.r() ->> 'total_out')::bigint + (pg_temp.r() ->> 'adjust_total')::bigint,
  'net = in - out + adjustments');
-- cards
select is((pg_temp.r() -> 'cash_now' ->> 'total')::bigint, (select coalesce(sum(m.amount), 0)::bigint from cash_movements m where m.company_id = 'a0000000-0000-7000-8000-000000000001'), 'cash now = every cash movement of the company, all time (any account)');
select is(pg_temp.r() -> 'cash_now' -> 'accounts', null, 'no list of accounts');
select is((pg_temp.r() -> 'returns_today' ->> 'returns_total')::bigint, 1200::bigint, 'today: sales returns');
select is((pg_temp.r() -> 'returns_today' ->> 'today_total')::bigint, 9200::bigint, 'today: returns 12.00 + deleted invoice 80.00');
-- permission
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select throws_ok($$select report_safe(current_date, current_date)$$, 'P0001', 'E_FORBIDDEN:للمدير فقط', 'a cashier device is refused');

select * from finish();
rollback;
