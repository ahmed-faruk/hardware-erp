-- LOCAL database only: server time of every report on the seeded volume (npm run perf:seed first).
-- Usage: npm run perf:explain   (writes perf-results/db.txt)
\set co '''a0000000-0000-7000-8000-000000000001'''
\timing on
\pset format unaligned
\pset tuples_only on
\echo === table sizes
select relname || ' ' || pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by pg_total_relation_size(oid) desc limit 15;
select 'database ' || pg_size_pretty(pg_database_size(current_database()));
\echo === reports: 1 day / 1 month / 400 days (each run twice: cold then warm)
\echo -- sales summary
select length(report_sales_summary_core(:co, current_date, current_date)::text);
select length(report_sales_summary_core(:co, current_date - 30, current_date)::text);
select length(report_sales_summary_core(:co, current_date - 400, current_date)::text);
select length(report_sales_summary_core(:co, current_date - 400, current_date)::text);
\echo -- profit
select length(report_profit_core(:co, current_date, current_date)::text);
select length(report_profit_core(:co, current_date - 30, current_date)::text);
select length(report_profit_core(:co, current_date - 400, current_date)::text);
\echo -- exceptions
select length(report_exceptions_core(:co, current_date, current_date)::text);
select length(report_exceptions_core(:co, current_date - 400, current_date)::text);
\echo -- purchases
select length(report_purchases_core(:co, current_date, current_date)::text);
select length(report_purchases_core(:co, current_date - 400, current_date)::text);
\echo -- expenses
select length(report_expenses_core(:co, current_date, current_date)::text);
select length(report_expenses_core(:co, current_date - 400, current_date)::text);
\echo -- categories
select length(report_categories_core(:co, current_date, current_date)::text);
select length(report_categories_core(:co, current_date - 30, current_date)::text);
select length(report_categories_core(:co, current_date - 400, current_date)::text);
\echo -- payroll
select length(report_payroll_core(:co, current_date - 400, current_date)::text);
\echo -- product history (a product with many legacy lines), 10 years
select length(report_product_history_core(:co, '00000000-0000-7000-8002-000000000007', current_date - 3650, current_date, 0)::text);
select length(report_product_history_core(:co, '00000000-0000-7000-8002-000000000007', current_date - 30, current_date, 0)::text);
\echo === what the planner does for the sargable shape of the sales range (explain)
explain (analyze, buffers, costs off) select count(*) from sales_invoices where company_id = :co and status = 'posted' and (issued_at at time zone 'Africa/Cairo')::date between current_date - 30 and current_date;
explain (analyze, buffers, costs off) select count(*) from sales_invoices where company_id = :co and status = 'posted' and issued_at >= (current_date - 30)::timestamp at time zone 'Africa/Cairo' and issued_at < (current_date + 1)::timestamp at time zone 'Africa/Cairo';
explain (analyze, buffers, costs off) select count(*) from sales_invoice_lines where product_id = '00000000-0000-7000-8002-000000000007';
