begin;
select plan(8);

insert into suppliers (id, company_id, name, legacy_person_id) values
  ('a0000000-0000-7000-8000-000000000701', 'a0000000-0000-7000-8000-000000000001', 'S-A', 990001),
  ('a0000000-0000-7000-8000-000000000702', 'a0000000-0000-7000-8000-000000000001', 'S-B', null);
insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, total, subtotal) values
  ('0190f000-0000-7000-8000-0000000007a1', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-900001', '2026-03-10 10:00+02', 'a0000000-0000-7000-8000-000000000701', 3000, 3000),
  ('0190f000-0000-7000-8000-0000000007a2', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-900002', '2026-03-11 10:00+02', 'a0000000-0000-7000-8000-000000000702', 5000, 5000),
  ('0190f000-0000-7000-8000-0000000007a3', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-900003', '2026-03-12 10:00+02', 'a0000000-0000-7000-8000-000000000701', 1000, 1000),
  ('0190f000-0000-7000-8000-0000000007a4', 'a0000000-0000-7000-8000-000000000001', 'K1-PUR-900004', '2025-01-01 10:00+02', 'a0000000-0000-7000-8000-000000000701', 9999, 9999);
insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values
  ('0190f000-0000-7000-8000-0000000007b1', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007a1', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 3000, 3000),
  ('0190f000-0000-7000-8000-0000000007b2', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007a2', 1, 'a0000000-0000-7000-8000-000000000002', 1000, 1000, 5000, 5000),
  ('0190f000-0000-7000-8000-0000000007b3', 'a0000000-0000-7000-8000-000000000001', '0190f000-0000-7000-8000-0000000007a3', 1, 'a0000000-0000-7000-8000-000000000001', 1000, 1000, 1000, 1000);
insert into legacy_purchases (company_id, id, kind, day, supplier_id, total, cash) values
  ('a0000000-0000-7000-8000-000000000001', 8801, 0, '2026-03-13', 990001, 700, 700),
  ('a0000000-0000-7000-8000-000000000001', 8802, 1, '2026-03-13', 990001, 100, 0);
insert into legacy_purchase_lines (purchase_id, line_no, product_id, text, qty, net) values (8801, 1, null, 'legacy item', 1000, 700);

create function pg_temp.r(p_supplier uuid) returns jsonb language sql as $$
  select report_purchases_suppliers_core('a0000000-0000-7000-8000-000000000001', '2026-03-01', '2026-03-31', p_supplier)
$$;
select is(jsonb_array_length(pg_temp.r(null) -> 'suppliers'), 2, 'two suppliers had purchases in the period');
select is(pg_temp.r(null) -> 'suppliers' -> 0 ->> 'name', 'S-B', 'ordered by total, the biggest first');
select is((pg_temp.r(null) -> 'suppliers' -> 1 ->> 'invoices')::int, 3, 'device invoices and the archive purchase are counted, the return and the old year are not');
select is((pg_temp.r(null) -> 'suppliers' -> 1 ->> 'total')::bigint, 4700::bigint, 'total of the supplier');
select is(pg_temp.r(null) -> 'suppliers' -> 1 -> 'list' -> 0 ->> 'number', 'LG-PUR-008801', 'invoices listed newest first, archive numbers shown');
select is(pg_temp.r(null) -> 'suppliers' -> 1 -> 'top' -> 0 ->> 'net', '4000', 'top product by net amount (same product on two invoices)');
select is(jsonb_array_length(pg_temp.r('a0000000-0000-7000-8000-000000000702') -> 'suppliers'), 1, 'one-supplier filter');
select throws_ok($$select report_purchases_suppliers('2026-03-01', '2026-03-31')$$, null, null, 'refused without a manager device');

select * from finish();
rollback;
