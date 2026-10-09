-- The acting worker travels as `worker_id` on the outbox row (an edit's created_by is the original creator)
create or replace function ingest_row(p_device devices, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  st sync_tables;
  rec jsonb := p_row -> 'record';
  w workers;
  actor uuid := coalesce((p_row ->> 'worker_id')::uuid, (rec ->> 'created_by')::uuid);
begin
  select * into st from sync_tables where table_name = p_row ->> 'table' and push_action is not null;
  if not found or p_row ->> 'op' is distinct from 'upsert' or jsonb_typeof(rec) <> 'object' or rec ->> 'id' is null then
    raise exception 'E_VALIDATION:جدول غير مسموح';
  end if;
  select * into w from workers
   where id = actor and company_id = p_device.company_id and active and deleted_at is null;
  if not found then
    raise exception 'E_FORBIDDEN:عامل غير معروف';
  end if;
  if w.role = 'manager' and p_device.max_role <> 'manager' then
    raise exception 'E_FORBIDDEN:الجهاز لا يسمح بهذا الدور';
  end if;
  if st.push_action <> 'any' and role_can(w.role, st.push_action) = 'no' then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;
