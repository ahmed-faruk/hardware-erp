-- Normalised md5 of every report that reads the imported history, on the seeded data: run before and after a data move, the lines must be identical.
\set co '''a0000000-0000-7000-8000-000000000001'''
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.norm(j jsonb) returns jsonb language plpgsql as $f$
begin
  if jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(pg_temp.norm(e) order by pg_temp.norm(e)::text) from jsonb_array_elements(j) e), '[]'::jsonb);
  elsif jsonb_typeof(j) = 'object' then
    return coalesce((select jsonb_object_agg(k, pg_temp.norm(v)) from jsonb_each(j) as t(k, v)), '{}'::jsonb);
  end if;
  return j;
end $f$;
select 'report_sales_summary_core 2026-10-01..2026-10-31 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2026-10-01', '2026-10-31'))::text);
select 'report_sales_summary_core 2025-09-01..2026-10-10 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2025-09-01', '2026-10-10'))::text);
select 'report_sales_summary_core 2021-02-01..2022-02-28 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2021-02-01', '2022-02-28'))::text);
select 'report_sales_summary_core 2017-06-29..2017-06-29 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2017-06-29', '2017-06-29'))::text);
select 'report_sales_summary_core 2019-01-01..2019-12-31 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2019-01-01', '2019-12-31'))::text);
select 'report_sales_summary_core 2017-06-01..2018-06-30 ' || md5(pg_temp.norm(report_sales_summary_core(:co, '2017-06-01', '2018-06-30'))::text);
select 'report_profit_core 2026-10-01..2026-10-31 ' || md5(pg_temp.norm(report_profit_core(:co, '2026-10-01', '2026-10-31'))::text);
select 'report_profit_core 2025-09-01..2026-10-10 ' || md5(pg_temp.norm(report_profit_core(:co, '2025-09-01', '2026-10-10'))::text);
select 'report_profit_core 2021-02-01..2022-02-28 ' || md5(pg_temp.norm(report_profit_core(:co, '2021-02-01', '2022-02-28'))::text);
select 'report_profit_core 2017-06-29..2017-06-29 ' || md5(pg_temp.norm(report_profit_core(:co, '2017-06-29', '2017-06-29'))::text);
select 'report_profit_core 2019-01-01..2019-12-31 ' || md5(pg_temp.norm(report_profit_core(:co, '2019-01-01', '2019-12-31'))::text);
select 'report_profit_core 2017-06-01..2018-06-30 ' || md5(pg_temp.norm(report_profit_core(:co, '2017-06-01', '2018-06-30'))::text);
select 'report_purchases_core 2026-10-01..2026-10-31 ' || md5(pg_temp.norm(report_purchases_core(:co, '2026-10-01', '2026-10-31'))::text);
select 'report_purchases_core 2025-09-01..2026-10-10 ' || md5(pg_temp.norm(report_purchases_core(:co, '2025-09-01', '2026-10-10'))::text);
select 'report_purchases_core 2021-02-01..2022-02-28 ' || md5(pg_temp.norm(report_purchases_core(:co, '2021-02-01', '2022-02-28'))::text);
select 'report_purchases_core 2017-06-29..2017-06-29 ' || md5(pg_temp.norm(report_purchases_core(:co, '2017-06-29', '2017-06-29'))::text);
select 'report_purchases_core 2019-01-01..2019-12-31 ' || md5(pg_temp.norm(report_purchases_core(:co, '2019-01-01', '2019-12-31'))::text);
select 'report_purchases_core 2017-06-01..2018-06-30 ' || md5(pg_temp.norm(report_purchases_core(:co, '2017-06-01', '2018-06-30'))::text);
select 'report_categories_core 2026-10-01..2026-10-31 ' || md5(pg_temp.norm(report_categories_core(:co, '2026-10-01', '2026-10-31'))::text);
select 'report_categories_core 2025-09-01..2026-10-10 ' || md5(pg_temp.norm(report_categories_core(:co, '2025-09-01', '2026-10-10'))::text);
select 'report_categories_core 2021-02-01..2022-02-28 ' || md5(pg_temp.norm(report_categories_core(:co, '2021-02-01', '2022-02-28'))::text);
select 'report_categories_core 2017-06-29..2017-06-29 ' || md5(pg_temp.norm(report_categories_core(:co, '2017-06-29', '2017-06-29'))::text);
select 'report_categories_core 2019-01-01..2019-12-31 ' || md5(pg_temp.norm(report_categories_core(:co, '2019-01-01', '2019-12-31'))::text);
select 'report_categories_core 2017-06-01..2018-06-30 ' || md5(pg_temp.norm(report_categories_core(:co, '2017-06-01', '2018-06-30'))::text);
select 'history_totals ' || (select jsonb_build_object('count', h ->> 'count', 'now', h ->> 'balance_now', 'in', (select sum((r ->> 'in_qty')::bigint) from jsonb_array_elements(h -> 'rows') r), 'out', (select sum((r ->> 'out_qty')::bigint) from jsonb_array_elements(h -> 'rows') r), 'legacy', (select count(*) from jsonb_array_elements(h -> 'rows') r where (r ->> 'legacy')::bool))::text
  from (select report_product_history_core(:co, '00000000-0000-7000-8002-000000000007', '2016-01-01', '2026-12-31', 0) h) x);
