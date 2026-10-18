begin;
select plan(30);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.r() returns jsonb language sql as $$
  select report_safe_core('a0000000-0000-7000-8000-000000000001', (now() at time zone 'Africa/Cairo')::date - 2, (now() at time zone 'Africa/Cairo')::date + 1)
$$;
create function pg_temp.d(p_key text) returns jsonb language sql as $$
  select report_safe_detail_core('a0000000-0000-7000-8000-000000000001', (now() at time zone 'Africa/Cairo')::date - 2, (now() at time zone 'Africa/Cairo')::date + 1, p_key, 0)
$$;
-- the amount of one line (-1 when the line is missing)
create function pg_temp.line(p_key text) returns bigint language sql as $$
  select coalesce((select (l ->> 'amount')::bigint from jsonb_array_elements(pg_temp.r() -> 'sections') s, jsonb_array_elements(s -> 'lines') l where l ->> 'key' = p_key), -1)
$$;
create function pg_temp.total(p_sec text) returns bigint language sql as $$
  select (s ->> 'total')::bigint from jsonb_array_elements(pg_temp.r() -> 'sections') s where s ->> 'key' = p_sec
$$;

insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-000000000001', 'Supplier 1');
-- sales invoices: S1 cash 100.00 + card 30.00; S2 voided cash; S3 cash 10 days ago; S4 credit; S5 InstaPay 20.00
insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status, customer_id) values
  ('0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960001', now(), 13000, 13000, 'posted', 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-0000000000c2', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960002', now(), 5000, 5000, 'voided', null),
  ('0190f000-0000-7000-8000-0000000000c3', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960003', now() - interval '10 days', 7777, 7777, 'posted', null),
  ('0190f000-0000-7000-8000-0000000000c4', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960004', now(), 1200, 1200, 'posted', 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-0000000000c5', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-960005', now(), 2000, 2000, 'posted', null);
insert into payments (id, company_id, document_type, document_id, method, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', 'cash', 10000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c1', 'card', 3000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c2', 'cash', 5000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c3', 'cash', 7777),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c4', 'credit', 1200),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000c5', 'instapay', 2000);
-- collections: cash 20.00, InstaPay 15.00, a voided cash one
insert into customer_receipts (id, company_id, number, issued_at, customer_id, amount, method, status) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RCV-960001', now(), 'a0000000-0000-7000-8000-000000000c01', 2000, 'cash', 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RCV-960002', now(), 'a0000000-0000-7000-8000-000000000c01', 1500, 'instapay', 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-RCV-960003', now(), 'a0000000-0000-7000-8000-000000000c01', 999, 'cash', 'voided');
-- sales returns: one refunded 4.00 in cash, one refunded to the customer's account (no cash)
insert into sales_returns (id, company_id, number, issued_at, total, refund_method, customer_id) values
  ('0190f000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-960001', now(), 400, 'cash', 'a0000000-0000-7000-8000-000000000c01'),
  ('0190f000-0000-7000-8000-0000000000d2', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-960002', now(), 200, 'credit', 'a0000000-0000-7000-8000-000000000c01');
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', -400, 'cash', 'sales_return', '0190f000-0000-7000-8000-0000000000d1', now());
-- the old system: a sale 30.00 cash + 15.00 card + 5.00 other, a cash return 8.00, an old sale outside the period
insert into legacy_sales (company_id, id, kind, day, total, cash, card, other, credit) values
  ('a0000000-0000-7000-8000-000000000001', 970001, 0, (now() at time zone 'Africa/Cairo')::date, 5000, 3000, 1500, 500, 0),
  ('a0000000-0000-7000-8000-000000000001', 970002, 1, (now() at time zone 'Africa/Cairo')::date, 800, 800, 0, 0, 0),
  ('a0000000-0000-7000-8000-000000000001', 970003, 0, (now() at time zone 'Africa/Cairo')::date - 30, 99999, 99999, 0, 0, 0);
-- purchases: P1 cash 15.00 + card 40.00; P2 credit; P3 from the owner's pocket 60.00; P4 voided cash
insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total, status) values
  ('0190f000-0000-7000-8000-0000000000a1', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960001', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 5500, 5500, 'posted'),
  ('0190f000-0000-7000-8000-0000000000a2', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960002', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000, 'posted'),
  ('0190f000-0000-7000-8000-0000000000a3', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960003', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 6000, 6000, 'posted'),
  ('0190f000-0000-7000-8000-0000000000a4', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-960004', now(), 'a0000000-0000-7000-8000-000000000501', 'a0000000-0000-7000-8000-0000000000c1', 9999, 9999, 'voided');
insert into payments (id, company_id, document_type, document_id, method, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', 'cash', 1500),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a1', 'card', 4000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a2', 'credit', 5000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a3', 'owner', 6000),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'purchase_invoice', '0190f000-0000-7000-8000-0000000000a4', 'cash', 9999);
-- supplier payments: cash 7.00, wallet 25.00, owner 35.00
insert into supplier_payments (id, company_id, number, issued_at, supplier_id, amount, method, status) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-PAY-960001', now(), 'a0000000-0000-7000-8000-000000000501', 700, 'cash', 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-PAY-960002', now(), 'a0000000-0000-7000-8000-000000000501', 2500, 'wallet', 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-PAY-960003', now(), 'a0000000-0000-7000-8000-000000000501', 3500, 'owner', 'posted');
-- a purchase return whose 2.50 came back into the box
insert into purchase_returns (id, company_id, number, issued_at, supplier_id, total) values
  ('0190f000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'K1-PRT-960001', now(), 'a0000000-0000-7000-8000-000000000501', 250);
insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000a13', 250, 'cash', 'purchase_return', '0190f000-0000-7000-8000-0000000000b1', now());
-- the old system: a purchase 12.00 cash + 8.00 credit, a cash purchase return 3.00
insert into legacy_purchases (company_id, id, kind, day, total, cash, credit, other) values
  ('a0000000-0000-7000-8000-000000000001', 971001, 0, (now() at time zone 'Africa/Cairo')::date, 2000, 1200, 800, 0),
  ('a0000000-0000-7000-8000-000000000001', 971002, 1, (now() at time zone 'Africa/Cairo')::date, 300, 300, 0, 0);
-- expenses: shop 3.00 from the box; a new «مشتريات» one 4.50 (not counted); an old-system one 6.00 (counted);
-- a shop one from outside the box 10.00 (listed only); a voided shop one
insert into expenses (id, company_id, number, issued_at, category_id, amount, cash_account_id, is_legacy, status, source) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-960001', now(), 'a0000000-0000-7000-8000-000000000e02', 300, 'a0000000-0000-7000-8000-000000000a13', false, 'posted', 'safe'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-960002', now(), 'a0000000-0000-7000-8000-000000000e01', 450, 'a0000000-0000-7000-8000-000000000a13', false, 'posted', 'safe'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'LG-EXP-960003', now(), 'a0000000-0000-7000-8000-000000000e01', 600, null, true, 'posted', 'safe'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-960004', now(), 'a0000000-0000-7000-8000-000000000e02', 1000, null, false, 'posted', 'owner'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-EXP-960005', now(), 'a0000000-0000-7000-8000-000000000e02', 555, 'a0000000-0000-7000-8000-000000000a13', false, 'voided', 'safe');
-- payroll of worker d1: an advance 10.00, a salary paid 20.00, a voided advance
insert into payroll_entries (id, company_id, number, issued_at, employee_id, kind, month, amount, status) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-ADV-960001', now(), 'a0000000-0000-7000-8000-0000000000d1', 'advance', '2026-10', 1000, 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-SAL-960001', now(), 'a0000000-0000-7000-8000-0000000000d1', 'salary', '2026-10', 2000, 'posted'),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-ADV-960002', now(), 'a0000000-0000-7000-8000-0000000000d1', 'advance', '2026-10', 333, 'voided');

-- sales: cash that came into the box
select is(pg_temp.line('cash_sales'), 10000::bigint, 'cash sales: only the cash part of posted invoices in the period');
select is(pg_temp.line('cash_receipts'), 2000::bigint, 'cash collections by their date; a voided one drops out');
select is(pg_temp.line('cash_sales_returns'), 400::bigint, 'cash refunded on returns; a refund to the account is not cash');
select is(pg_temp.line('legacy_cash_sales'), 3000::bigint, 'old-system cash sales in the period');
select is(pg_temp.line('legacy_cash_sales_returns'), 800::bigint, 'old-system cash returns');
select is(pg_temp.total('sales'), 13800::bigint, 'sales = 100 + 20 - 4 + 30 - 8');
-- purchases from the box
select is(pg_temp.line('cash_purchases'), 1500::bigint, 'cash paid from the box on posted purchases; a voided one drops out');
select is(pg_temp.line('cash_supplier_payments'), 700::bigint, 'cash supplier payments by their date');
select is(pg_temp.line('cash_purchase_returns'), 250::bigint, 'cash back into the box from purchase returns');
select is(pg_temp.line('legacy_cash_purchases'), 1200::bigint, 'old-system cash purchases');
select is(pg_temp.line('legacy_cash_purchase_returns'), 300::bigint, 'old-system cash purchase returns');
select is(pg_temp.total('purchases'), 2850::bigint, 'purchases = 15 + 7 - 2.50 + 12 - 3');
-- expenses and payroll
select is(pg_temp.line('shop_expenses'), 300::bigint, 'shop expenses from the box; «مشتريات» and voided ones drop out');
select is(pg_temp.line('legacy_expenses'), 600::bigint, 'every old-system expense counts');
select is(pg_temp.total('expenses'), 900::bigint, 'expenses = 3 + 6');
select is(pg_temp.line('advances'), 1000::bigint, 'advances; a voided one drops out');
select is(pg_temp.line('salaries'), 2000::bigint, 'salaries paid');
select is(pg_temp.total('payroll'), 3000::bigint, 'payroll = 10 + 20');
-- listed, not counted
select is(pg_temp.line('transfers_sales'), 7000::bigint, 'transfer sales: card 30 + InstaPay 20 + old card/other 20');
select is(pg_temp.line('transfers_receipts'), 1500::bigint, 'transfer collections');
select is(pg_temp.line('transfers_purchases'), 6500::bigint, 'transfer purchases and supplier payments: card 40 + wallet 25');
select is(pg_temp.line('owner_paid'), 9500::bigint, 'owner-paid: purchase 60 + supplier payment 35');
select is(pg_temp.line('outside_expenses'), 1000::bigint, 'expenses from outside the box');
select is((pg_temp.r() ->> 'net')::bigint, 7050::bigint, 'net = 138 - 28.50 - 9 - 30');
-- the drill-down equals every line
select ok(not exists (
  select 1 from jsonb_array_elements(pg_temp.r() -> 'sections') s, jsonb_array_elements(s -> 'lines') l
   where (l ->> 'amount')::bigint <> (pg_temp.d(l ->> 'key') ->> 'total')::bigint
      or (l ->> 'count')::int <> (pg_temp.d(l ->> 'key') ->> 'count')::int), 'every line equals the total and count of its drill-down');
select is(pg_temp.d('cash_sales') -> 'rows' -> 0 ->> 'number', 'K1-INV-960001', 'the drill-down lists the invoice the cash came from');
-- the cards stay
select is((pg_temp.r() -> 'cash_now' ->> 'total')::bigint, (select coalesce(sum(m.amount), 0)::bigint from cash_movements m where m.company_id = 'a0000000-0000-7000-8000-000000000001' and m.deleted_at is null), 'cash now = every cash movement');
select is((pg_temp.r() -> 'returns_today' ->> 'returns_total')::bigint, 600::bigint, 'today: sales returns 4 + 2');
-- the wrapper
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select report_safe_detail(current_date, current_date, 'nope', 0)$$, 'P0001', 'E_VALIDATION:بند غير صالح', 'an unknown line is refused');
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select throws_ok($$select report_safe_detail(current_date, current_date, 'cash_sales', 0)$$, 'P0001', 'E_FORBIDDEN:للمدير فقط', 'a cashier device is refused');

select * from finish();
rollback;
