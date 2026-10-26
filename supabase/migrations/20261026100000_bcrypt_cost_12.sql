-- Security fix (audit 2026-10-20, L3 / HE-11): worker passwords were hashed with pgcrypto's default bcrypt cost 6. New and changed passwords use cost 12;
-- existing hashes keep working (crypt() reads the cost from the stored hash) and are upgraded the next time their password is set.
-- Same change as PR #83, re-dated so it applies after the migrations already on production.

-- gives a worker a login, or changes the password (username only when the worker has none yet)
create or replace function set_worker_login(p_actor uuid, p_worker uuid, p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare w workers; u text := nullif(lower(trim(coalesce(p_username, ''))), '');
begin
  if current_company() is null then raise exception 'E_FORBIDDEN'; end if;
  select * into w from workers where id = p_worker and company_id = current_company() and deleted_at is null;
  if not found then raise exception 'E_VALIDATION:عامل غير موجود'; end if;
  if not (p_actor = p_worker or worker_can(p_actor, 'manageUsers') = 'yes') then raise exception 'E_FORBIDDEN:غير مسموح'; end if;
  if not exists (select 1 from workers a where a.id = p_actor and a.company_id = current_company() and a.active) then raise exception 'E_FORBIDDEN:غير مسموح'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'E_VALIDATION:كلمة السر 6 حروف على الأقل'; end if;
  if w.username is null then
    if u is null or u !~ '^[a-z0-9_.]{3,30}$' then raise exception 'E_VALIDATION:اسم المستخدم غير صالح'; end if;
    if exists (select 1 from workers x where x.username = u and x.deleted_at is null) then raise exception 'E_VALIDATION:اسم المستخدم موجود'; end if;
    update workers set username = u, updated_at = now(), version = version + 1 where id = w.id;
  elsif u is not null and u <> w.username then
    raise exception 'E_VALIDATION:اسم المستخدم مايتغيرش';
  end if;
  insert into worker_credentials (worker_id, company_id, password_hash, must_change)
  values (w.id, w.company_id, crypt(p_password, gen_salt('bf', 12)), false)
  on conflict (worker_id) do update set password_hash = excluded.password_hash, must_change = false, failed = 0, locked_until = null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('username', coalesce(u, w.username)));
end $$;
grant execute on function set_worker_login(uuid, uuid, text, text) to authenticated;
