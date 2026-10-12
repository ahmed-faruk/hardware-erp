-- A fingerprint (md5) of every report on the seeded data: run before and after a change, the lines must be identical.
\set co '''a0000000-0000-7000-8000-000000000001'''
\pset format unaligned
\pset tuples_only on
select 'sales_day ' || md5(report_sales_summary_core(:co, '2026-10-01', '2026-10-31')::text);
select 'sales_400 ' || md5(report_sales_summary_core(:co, '2025-09-01', '2026-10-10')::text);
select 'sales_old ' || md5(report_sales_summary_core(:co, '2021-02-01', '2022-02-28')::text);
select 'profit_400 ' || md5(report_profit_core(:co, '2025-09-01', '2026-10-10')::text);
select 'profit_old ' || md5(report_profit_core(:co, '2021-02-01', '2022-02-28')::text);
select 'excep_400 ' || md5(report_exceptions_core(:co, '2025-09-01', '2026-10-10')::text);
select 'purch_old ' || md5(report_purchases_core(:co, '2021-02-01', '2022-02-28')::text);
select 'exp_old ' || md5(report_expenses_core(:co, '2021-02-01', '2022-02-28')::text);
select 'cat_old ' || md5(report_categories_core(:co, '2021-02-01', '2022-02-28')::text);
select 'cat_400 ' || md5(report_categories_core(:co, '2025-09-01', '2026-10-10')::text);
select 'pay_400 ' || md5(report_payroll_core(:co, '2025-09-01', '2026-10-10')::text);
select 'hist ' || md5(report_product_history_core(:co, '00000000-0000-7000-8002-000000000007', '2016-01-01', '2026-12-31', 0)::text);
