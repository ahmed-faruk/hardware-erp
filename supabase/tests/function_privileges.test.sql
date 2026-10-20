begin;
select plan(2);
-- no ingest bundle may be reachable over /rest/v1/rpc; this also catches a bundle added later without its revoke
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'ingest\_%\_bundle'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
          0, 'anon and authenticated cannot execute any ingest bundle');
select ok(has_function_privilege('authenticated', 'ingest_batch(uuid, text, jsonb)', 'execute'), 'devices can still push through ingest_batch');
select * from finish();
rollback;
