-- bootstrap_admin also makes sure the company has its one box (the safe), because devices no longer create cash accounts.

create or replace function bootstrap_admin() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; wid uuid; made int := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'E_FORBIDDEN'; end if;
  -- the shop has one box: every company gets its safe «الخزنة» if it has none yet
  insert into cash_accounts (id, company_id, name, kind)
  select gen_random_uuid(), co.id, 'الخزنة', 'safe' from companies co
   where not exists (select 1 from cash_accounts a where a.company_id = co.id and a.kind = 'safe' and a.deleted_at is null);
  for c in select id from companies where not exists (select 1 from workers w where w.company_id = companies.id and w.username is not null and w.deleted_at is null) loop
    wid := gen_random_uuid();
    insert into workers (id, company_id, name, role, active, username) values (wid, c.id, 'admin', 'manager', true, 'admin');
    insert into worker_credentials (worker_id, company_id, password_hash, must_change) values (wid, c.id, crypt('admin', gen_salt('bf')), true);
    made := made + 1;
  end loop;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('created', made));
end $$;
