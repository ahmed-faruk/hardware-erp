begin;
select plan(7);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- the service role imports a legacy invoice (with a legacy line) and a live product
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((import_batch('sales_invoices', jsonb_build_array(jsonb_build_object(
  'id', '0190f000-0000-7000-8000-0000000000a1', 'company_id', 'a0000000-0000-7000-8000-000000000001', 'number', 'LG-INV-000001',
  'issued_at', now(), 'status', 'posted', 'is_legacy', true, 'subtotal', 100, 'total', 100))) -> 'data' ->> 'inserted')::int, 1,
  'service role can import');
select is((import_batch('sales_invoices', jsonb_build_array(jsonb_build_object(
  'id', '0190f000-0000-7000-8000-0000000000a1', 'company_id', 'a0000000-0000-7000-8000-000000000001', 'number', 'LG-INV-000001',
  'issued_at', now(), 'status', 'posted', 'is_legacy', true, 'subtotal', 100, 'total', 100))) -> 'data' ->> 'inserted')::int, 0,
  'importing the same row again inserts nothing');
select import_batch('sales_invoice_lines', jsonb_build_array(jsonb_build_object(
  'id', '0190f000-0000-7000-8000-0000000000a2', 'company_id', 'a0000000-0000-7000-8000-000000000001',
  'invoice_id', '0190f000-0000-7000-8000-0000000000a1', 'line_no', 1, 'qty', 1000, 'is_legacy', true)));
select is((import_batch('nope', '[{"id":"x"}]') -> 'error' ->> 'code'), 'E_VALIDATION', 'unknown table is refused');
select is((import_batch('products', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'bogus_column', 1))) -> 'error' ->> 'code'),
  'E_VALIDATION', 'unknown column is refused');
reset role;

-- devices never receive the legacy archive
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select ok(not exists (select 1 from jsonb_array_elements(pull_changes(0, 1000) -> 'data' -> 'rows') r
                       where r ->> 'table' in ('sales_invoices', 'sales_invoice_lines') and r -> 'record' ->> 'id' like '0190f000-0000-7000-8000-0000000000a%'),
  'pull_changes hides legacy documents and lines');
reset role;
select is((select count(*)::int from sales_invoice_lines where is_legacy), 1, 'the legacy line exists on the server');
-- a device cannot smuggle is_legacy through ingest_batch
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((ingest_batch('a0000000-0000-7000-8000-0000000000f1', '0.0.0', jsonb_build_array(jsonb_build_object(
  'seq', 1, 'table', 'audit_log', 'op', 'upsert', 'record', jsonb_build_object(
    'id', gen_random_uuid(), 'created_by', 'a0000000-0000-7000-8000-0000000000d1', 'action', 'x', 'entity', 'y', 'occurred_at', now())))) -> 'data' -> 'rejected'),
  '[]'::jsonb, 'normal audit rows still ingest');
reset role;

select * from finish();
rollback;
