-- Legacy import support (phase 4): is_legacy on every legacy child table, import_batch, and a pull filter
-- that keeps the OpenSourcePOS archive on the server (docs/DATABASE.md §10).
alter table sales_invoice_lines add column is_legacy bool not null default false;
alter table payments add column is_legacy bool not null default false;
alter table sales_return_lines add column is_legacy bool not null default false;
alter table purchase_invoice_lines add column is_legacy bool not null default false;
alter table purchase_return_lines add column is_legacy bool not null default false;

-- devices can never mark their own rows as legacy
create or replace function ingest_insert(p_table text, p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  bad text;
  cols text;
  n int;
  existing uuid;
begin
  rec := (p_rec - 'server_seq' - 'updated_at' - 'is_legacy') || jsonb_build_object('company_id', p_company, 'device_id', p_device);
  select string_agg(k, ', ') into bad
    from jsonb_object_keys(rec) k
   where k not in (select attname::text from pg_attribute
                    where attrelid = ('public.' || quote_ident(p_table))::regclass and attnum > 0 and not attisdropped);
  if bad is not null then
    raise exception 'E_VALIDATION:حقول غير معروفة';
  end if;
  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(rec) k;
  execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing',
                 p_table, cols, cols, p_table) using rec;
  get diagnostics n = row_count;
  if n = 0 then
    execute format('select company_id from %I where id = $1', p_table) into existing using (rec ->> 'id')::uuid;
    if existing is distinct from p_company then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
end $$;

create or replace function pull_changes(p_after_seq bigint, p_max_rows int default 1000) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d devices;
  st sync_tables;
  q text := '';
  expr text;
  c text;
  arr jsonb;
  has_more boolean;
  lim int := least(greatest(coalesce(p_max_rows, 1000), 1), 1000);
  is_mgr boolean;
  legacy text;
begin
  perform assert_device_active();
  select * into d from current_device();
  is_mgr := d.max_role = 'manager';
  for st in select * from sync_tables where pull = 'all' or (pull = 'manager' and is_mgr) order by table_name loop
    expr := 'to_jsonb(x)';
    if not is_mgr then
      foreach c in array st.cost_columns loop
        expr := expr || format(' - %L', c);
      end loop;
    end if;
    -- the legacy (OpenSourcePOS) archive stays on the server; devices never receive it
    legacy := case when exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(st.table_name))::regclass
                                   and attname = 'is_legacy' and not attisdropped) then ' and not x.is_legacy' else '' end;
    q := q || case when q = '' then '' else ' union all ' end
         || format('(select %L::text as t, x.server_seq as s, %s as rec from %I x where x.company_id = $1 and x.server_seq > $2%s order by x.server_seq limit $3)',
                   st.table_name, expr, st.table_name, legacy);
  end loop;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''table'', t, ''record'', rec) order by s), ''[]''::jsonb) from (select * from (%s) u order by s limit $3) z', q)
    into arr using d.company_id, p_after_seq, lim + 1;
  has_more := jsonb_array_length(arr) > lim;
  if has_more then
    select jsonb_agg(e order by ord) into arr from jsonb_array_elements(arr) with ordinality t (e, ord) where ord <= lim;
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'rows', arr,
    'last_seq', coalesce((arr -> -1 -> 'record' ->> 'server_seq')::bigint, p_after_seq),
    'has_more', has_more));
end $$;

-- service role only: bulk insert of already-built rows, idempotent (on conflict (id) do nothing)
create or replace function import_batch(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cols text;
  bad text;
  n int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'E_FORBIDDEN';
  end if;
  if not exists (select 1 from sync_tables where table_name = p_kind) or p_kind in ('devices', 'audit_log', 'client_errors') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'جدول غير مسموح'));
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 1000 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'دفعة غير صالحة'));
  end if;
  select string_agg(k, ', ') into bad
    from jsonb_object_keys(p_rows -> 0) k
   where k not in (select attname::text from pg_attribute
                    where attrelid = ('public.' || quote_ident(p_kind))::regclass and attnum > 0 and not attisdropped)
      or k = 'server_seq';
  if bad is not null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'حقول غير معروفة: ' || bad));
  end if;
  perform pg_advisory_xact_lock(7300001);
  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict (id) do nothing',
                 p_kind, cols, cols, p_kind) using p_rows;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('inserted', n, 'skipped', jsonb_array_length(p_rows) - n));
end $$;
