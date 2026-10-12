-- LOCAL database only (npm run perf:seed): synthetic data with the staging volume of the imported OpenSourcePOS history,
-- to measure screens and report queries. Nothing here is real customer data. Safe to run twice: it removes its own rows first.
\set ON_ERROR_STOP on
\timing on
\set co '''a0000000-0000-7000-8000-000000000001'''
\set wh '''a0000000-0000-7000-8000-0000000000c1'''

-- 0. clean earlier perf rows (ids with the 00000000-0000-7000-8 prefix)
delete from payments where company_id = :co and id::text like '00000000-0000-7000-8%';
delete from stock_movements where company_id = :co and id::text like '00000000-0000-7000-8%';
delete from sales_invoice_lines where id::text like '00000000-0000-7000-8%';
delete from sales_return_lines where id::text like '00000000-0000-7000-8%';
delete from purchase_invoice_lines where id::text like '00000000-0000-7000-8%';
delete from purchase_return_lines where id::text like '00000000-0000-7000-8%';
delete from sales_invoices where id::text like '00000000-0000-7000-8%';
delete from sales_returns where id::text like '00000000-0000-7000-8%';
delete from purchase_invoices where id::text like '00000000-0000-7000-8%';
delete from purchase_returns where id::text like '00000000-0000-7000-8%';
delete from expenses where id::text like '00000000-0000-7000-8%';
delete from products where id::text like '00000000-0000-7000-8%';
delete from categories where id::text like '00000000-0000-7000-8%';
delete from customers where id::text like '00000000-0000-7000-8%';
delete from suppliers where id::text like '00000000-0000-7000-8%';
delete from expense_categories where id::text like '00000000-0000-7000-8%';

create or replace function pg_temp.pid(p_kind int, p_i bigint) returns uuid language sql immutable as $$
  select ('00000000-0000-7000-8' || lpad(p_kind::text, 3, '0') || '-' || lpad(p_i::text, 12, '0'))::uuid
$$;

-- 1. catalog: 9 categories, 1,406 products, 36 customers, 38 suppliers, 21 expense categories
insert into categories (id, company_id, name, color_token) select pg_temp.pid(1, i), :co, 'تصنيف ' || i, 'cat-' || ((i % 8) + 1) from generate_series(1, 9) i;
insert into products (id, company_id, name, base_unit_name, type, sku, category_id, price, unit_cost, reorder_level, legacy_item_id)
select pg_temp.pid(2, i), :co, 'صنف أداء ' || i, 'pcs', 'stock', 'PERF' || i, pg_temp.pid(1, (i % 9) + 1),
       (500 + (i * 37) % 90000)::bigint, (300 + (i * 23) % 60000)::bigint, 5000, 100000 + i from generate_series(1, 1406) i;
insert into customers (id, company_id, name, phone, legacy_person_id) select pg_temp.pid(3, i), :co, 'عميل أداء ' || i, '010' || lpad(i::text, 8, '0'), 200000 + i from generate_series(1, 36) i;
insert into suppliers (id, company_id, name, legacy_person_id) select pg_temp.pid(4, i), :co, 'مورد أداء ' || i, 300000 + i from generate_series(1, 38) i;
insert into expense_categories (id, company_id, name) select pg_temp.pid(5, i), :co, 'مصروف أداء ' || i from generate_series(1, 21) i;

-- 2. imported sales history: 63,049 invoices over ~9 years, 317,661 lines, 73,840 payments (legacy flag on, like the import)
insert into sales_invoices (id, company_id, number, issued_at, status, is_legacy, customer_id, subtotal, total, legacy)
select pg_temp.pid(10, i), :co, 'PERF-S-' || i,
       timestamptz '2017-06-29 10:00:00+03' + ((i - 1)::numeric / 63049 * 3400 || ' days')::interval + ((i * 7919) % 36000 || ' seconds')::interval,
       'posted', true, case when i % 9 = 0 then pg_temp.pid(3, (i % 36) + 1) end,
       ((i * 7919) % 90000 + 500)::bigint, ((i * 7919) % 90000 + 500)::bigint,
       jsonb_build_object('ospos_id', i, 'type_code', 'نقطة بيع', 'payment_type', 'نقدى', 'employee_name', 'بائع', 'cost', 100, 'profit', 100)
  from generate_series(1, 63049) i;
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, alloc_discount, is_legacy)
select pg_temp.pid(11, i), :co, pg_temp.pid(10, ((i - 1) % 63049) + 1), ((i - 1) / 63049)::int + 1, pg_temp.pid(2, ((i * 31) % 1406) + 1), 1000,
       (((i * 13) % 5) + 1) * 1000, ((i * 37) % 90000 + 500)::bigint, ((i * 37) % 90000 + 500)::bigint * (((i * 13) % 5) + 1), ((i * 23) % 60000 + 300)::bigint, 0, 0, true
  from generate_series(1, 317661) i;
insert into payments (id, company_id, document_type, document_id, method, amount, is_legacy)
select pg_temp.pid(12, i), :co, 'sales_invoice', pg_temp.pid(10, ((i - 1) % 63049) + 1), case when i % 7 = 0 then 'credit' when i % 5 = 0 then 'card' else 'cash' end, ((i * 7919) % 90000 + 500)::bigint, true
  from generate_series(1, 73840) i;

-- 3. returns, purchases, purchase returns, expenses
insert into sales_returns (id, company_id, number, issued_at, status, is_legacy, refund_method, customer_id, total)
select pg_temp.pid(20, i), :co, 'PERF-R-' || i, timestamptz '2017-07-10 10:00:00+03' + ((i::numeric / 5455) * 3400 || ' days')::interval, 'posted', true, 'cash', null, 5000 from generate_series(1, 5455) i;
insert into sales_return_lines (id, company_id, return_id, product_id, qty, net_amount, unit_cost, is_legacy)
select pg_temp.pid(21, i), :co, pg_temp.pid(20, ((i - 1) % 5455) + 1), pg_temp.pid(2, ((i * 31) % 1406) + 1), 1000, 5000, 3000, true from generate_series(1, 6941) i;
insert into purchase_invoices (id, company_id, number, issued_at, status, is_legacy, supplier_id, warehouse_id, subtotal, total)
select pg_temp.pid(30, i), :co, 'PERF-P-' || i, timestamptz '2017-07-01 10:00:00+03' + ((i::numeric / 5245) * 3400 || ' days')::interval, 'posted', true, pg_temp.pid(4, (i % 38) + 1), :wh, 100000, 100000 from generate_series(1, 5245) i;
insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount, is_legacy)
select pg_temp.pid(31, i), :co, pg_temp.pid(30, ((i - 1) % 5245) + 1), ((i - 1) / 5245)::int + 1, pg_temp.pid(2, ((i * 17) % 1406) + 1), 1000, 10000, 3000, 30000, true from generate_series(1, 23570) i;
insert into purchase_returns (id, company_id, number, issued_at, status, is_legacy, supplier_id, total) select pg_temp.pid(32, i), :co, 'PERF-PR-' || i, timestamptz '2018-01-01 10:00:00+03' + (i * 20 || ' days')::interval, 'posted', true, pg_temp.pid(4, (i % 38) + 1), 3000 from generate_series(1, 93) i;
insert into purchase_return_lines (id, company_id, return_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount, is_legacy)
select pg_temp.pid(33, i), :co, pg_temp.pid(32, ((i - 1) % 93) + 1), 1, pg_temp.pid(2, ((i * 17) % 1406) + 1), 1000, 1000, 3000, 3000, true from generate_series(1, 165) i;
insert into expenses (id, company_id, number, issued_at, status, is_legacy, category_id, amount)
select pg_temp.pid(40, i), :co, 'PERF-E-' || i, timestamptz '2019-01-01 10:00:00+03' + ((i::numeric / 6000) * 2800 || ' days')::interval, 'posted', true, pg_temp.pid(5, (i % 21) + 1), (1000 + (i * 97) % 40000)::bigint from generate_series(1, 6000) i;

-- 4. the device era: 2,000 invoices in the last 90 days with their stock movements and cash payments
insert into sales_invoices (id, company_id, number, issued_at, status, is_legacy, customer_id, subtotal, total)
select pg_temp.pid(50, i), :co, 'PERF-K1-INV-' || lpad(i::text, 6, '0'), now() - ((i::numeric / 2000) * 90 || ' days')::interval, 'posted', false, null, 20000, 20000 from generate_series(1, 2000) i;
insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, alloc_discount, is_legacy)
select pg_temp.pid(51, i), :co, pg_temp.pid(50, i), 1, pg_temp.pid(2, ((i * 31) % 1406) + 1), 1000, 2000, 10000, 20000, 6000, 0, 0, false from generate_series(1, 2000) i;
insert into payments (id, company_id, document_type, document_id, method, amount, is_legacy) select pg_temp.pid(52, i), :co, 'sales_invoice', pg_temp.pid(50, i), 'cash', 20000, false from generate_series(1, 2000) i;
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, line_id, occurred_at)
select pg_temp.pid(53, i), :co, pg_temp.pid(2, ((i * 31) % 1406) + 1), :wh, -2000, 6000, 'sales_invoice', pg_temp.pid(50, i), pg_temp.pid(51, i), now() - ((i::numeric / 2000) * 90 || ' days')::interval from generate_series(1, 2000) i;
insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at)
select pg_temp.pid(54, i), :co, pg_temp.pid(2, i), :wh, 20000, 3000, 'opening', gen_random_uuid(), timestamptz '2026-10-09 10:00:00+03' from generate_series(1, 1406) i;

analyze;
select 'rows' k, (select count(*) from sales_invoices) invoices, (select count(*) from sales_invoice_lines) lines, (select count(*) from payments) payments;
select relname, pg_size_pretty(pg_total_relation_size(oid)) size from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by pg_total_relation_size(oid) desc limit 12;
select pg_size_pretty(pg_database_size(current_database())) db_size;
