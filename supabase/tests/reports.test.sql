begin;
select plan(13);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- fixtures (superuser): Cairo is UTC+3 in October, so 22:30 UTC on 30 Sep is 01:30 on 1 Oct there
insert into sales_invoices (id, company_id, number, issued_at, subtotal, total, worker_id, status, is_legacy) values
  ('0190f000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000001', '2026-09-30 22:30:00+00', 10000, 10000, 'a0000000-0000-7000-8000-0000000000d1', 'posted', false),
  ('0190f000-0000-7000-8000-0000000000b2', 'a0000000-0000-7000-8000-000000000001', 'OSPOS-2', '2026-10-01 10:00:00+00', 5000, 5000, 'a0000000-0000-7000-8000-0000000000d1', 'posted', true),
  ('0190f000-0000-7000-8000-0000000000b3', 'a0000000-0000-7000-8000-000000000001', 'K1-INV-000003', '2026-10-02 08:00:00+00', 2000, 2000, 'a0000000-0000-7000-8000-0000000000d1', 'voided', false);
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, is_legacy) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000b1', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 2000, 5100, 10000, 400, 200, false),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000b2', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 5000, 5000, 3000, 0, true);
insert into payments (id, company_id, document_type, document_id, method, amount, is_legacy) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000b1', 'cash', 10000, false),
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'sales_invoice', '0190f000-0000-7000-8000-0000000000b2', 'card', 5000, true);
insert into sales_returns (id, company_id, number, issued_at, total, refund_method) values
  ('0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'K1-RET-000001', '2026-10-02 09:00:00+00', 1000, 'cash');
insert into sales_return_lines (id, company_id, return_id, product_id, qty, net_amount, unit_cost) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 400);
insert into voids (id, company_id, number, issued_at, target_type, target_id, reason) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-VOID-000001', '2026-10-02 08:30:00+00', 'sales_invoice', '0190f000-0000-7000-8000-0000000000b3', 'mistake');

select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{total,gross}', '15000', 'gross sales of the period (the voided invoice is out)');
select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{total,net}', '14000', 'net = gross − returns');
select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{days,0,invoices}', '2', 'the 01:30 Cairo invoice counts on 1 October, not 30 September');
select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-09-30', '2026-09-30') #>> '{total,invoices}', '0', '… and 30 September has none');
select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{by_method,0}', '{"amount": 5000, "method": "card"}', 'payments by method (legacy included)');
select is(report_sales_summary_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') ->> 'legacy_invoices', '1', 'the legacy invoice is counted and flagged');
select is(report_profit_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{total,profit}', '10600', 'profit = revenue − cost with returns taken back (14000 − 3400)');
select is(report_exceptions_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{voids,0,number}', 'K1-VOID-000001', 'the void is listed');
select is(report_exceptions_core('a0000000-0000-7000-8000-000000000001', '2026-10-01', '2026-10-02') #>> '{discounts,amount}', '200', 'discounts given on new invoices');

select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(report_sales_summary('2026-10-01', '2026-10-02') #>> '{data,total,net}', '14000', 'a manager device gets the report through the RPC');
select is(jsonb_array_length(report_devices() #> '{data}'), 3, 'the devices report lists the three seeded devices');
reset role;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e3');
select throws_ok($$select report_sales_summary('2026-10-01', '2026-10-02')$$, 'P0001', 'E_FORBIDDEN:للمدير فقط', 'a cashier device is refused');
reset role;
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select report_profit('2026-01-01', '2027-12-31')$$, 'P0001', 'E_VALIDATION:فترة غير صالحة', 'a period over 400 days is refused');
reset role;

select * from finish();
rollback;
