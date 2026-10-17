-- Login by username + password (owner decision 2026-10-17): no activation codes, no PINs, no approvals.
-- Passwords are bcrypt on the server (never pulled to devices). A new browser registers itself as a manager device on its first correct login.

alter table workers add column username text;
create unique index workers_username_uq on workers (username) where username is not null and deleted_at is null;

create table worker_credentials (
  worker_id uuid primary key references workers (id),
  company_id uuid not null references companies (id),
  password_hash text not null,
  must_change boolean not null default false,
  failed int not null default 0,
  locked_until timestamptz
);
alter table worker_credentials enable row level security;
revoke all on worker_credentials from public, anon, authenticated;

create function base36(p_n int) returns text language sql immutable as $$
  with recursive d(n, s) as (select p_n, ''::text union all select n / 36, substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', n % 36 + 1, 1) || s from d where n > 0)
  select s from d where n = 0
$$;

-- checks a password (bcrypt) with a lockout: 5 wrong tries lock the username for 15 minutes
create function check_worker_password(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare w workers; c worker_credentials;
begin
  select * into w from workers where username = lower(trim(p_username)) and active and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_LOGIN', 'message', 'اسم المستخدم أو كلمة السر غلط')); end if;
  select * into c from worker_credentials where worker_id = w.id;
  if not found then return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_LOGIN', 'message', 'اسم المستخدم أو كلمة السر غلط')); end if;
  if c.locked_until is not null and c.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_LOCKED', 'message', 'مقفول ربع ساعة'));
  end if;
  if crypt(p_password, c.password_hash) <> c.password_hash then
    update worker_credentials
       set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
           locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else null end
     where worker_id = w.id;
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_LOGIN', 'message', 'اسم المستخدم أو كلمة السر غلط'));
  end if;
  update worker_credentials set failed = 0, locked_until = null where worker_id = w.id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('worker_id', w.id, 'company_id', w.company_id, 'must_change', c.must_change));
end $$;
revoke all on function check_worker_password(text, text) from public, anon, authenticated;

-- first login on a new browser: the browser's own fresh auth user + a correct worker password registers a manager device
create function login_device(p_username text, p_password text, p_device_name text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; d devices; n int; pfx text; comp uuid;
begin
  if auth.uid() is null then raise exception 'E_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(7300002);
  r := check_worker_password(p_username, p_password);
  if not (r ->> 'ok')::boolean then return r; end if;
  comp := (r -> 'data' ->> 'company_id')::uuid;
  select * into d from devices where auth_user_id = auth.uid() and revoked_at is null;
  if not found then
    n := (select count(*) from devices where company_id = comp) + 1;
    loop
      pfx := 'K' || base36(n);
      exit when not exists (select 1 from devices where company_id = comp and prefix = pfx);
      n := n + 1;
    end loop;
    insert into devices (id, company_id, name, prefix, kind, max_role, auth_user_id)
    values (gen_random_uuid(), comp, left(coalesce(nullif(trim(p_device_name), ''), 'جهاز'), 40), pfx,
            case when p_kind = 'mobile' then 'mobile' else 'pc' end, 'manager', auth.uid())
    returning * into d;
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('device_id', d.id, 'company_id', d.company_id, 'prefix', d.prefix,
    'max_role', d.max_role, 'worker_id', r -> 'data' -> 'worker_id', 'must_change', r -> 'data' -> 'must_change'));
end $$;
grant execute on function login_device(text, text, text, text) to authenticated;

-- a device that is already registered checks a worker's password (online login on the device)
create function verify_worker_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if current_company() is null then raise exception 'E_FORBIDDEN'; end if;
  r := check_worker_password(p_username, p_password);
  if (r ->> 'ok')::boolean and (r -> 'data' ->> 'company_id')::uuid <> current_company() then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_LOGIN', 'message', 'اسم المستخدم أو كلمة السر غلط'));
  end if;
  return r;
end $$;
grant execute on function verify_worker_login(text, text) to authenticated;

-- gives a worker a login, or changes the password (username only when the worker has none yet)
create function set_worker_login(p_actor uuid, p_worker uuid, p_username text, p_password text) returns jsonb
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
  values (w.id, w.company_id, crypt(p_password, gen_salt('bf')), false)
  on conflict (worker_id) do update set password_hash = excluded.password_hash, must_change = false, failed = 0, locked_until = null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('username', coalesce(u, w.username)));
end $$;
grant execute on function set_worker_login(uuid, uuid, text, text) to authenticated;

-- service role, once per company: the first account admin/admin, which must change its password
create function bootstrap_admin() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; wid uuid; made int := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'E_FORBIDDEN'; end if;
  for c in select id from companies where not exists (select 1 from workers w where w.company_id = companies.id and w.username is not null and w.deleted_at is null) loop
    wid := gen_random_uuid();
    insert into workers (id, company_id, name, role, active, username) values (wid, c.id, 'admin', 'manager', true, 'admin');
    insert into worker_credentials (worker_id, company_id, password_hash, must_change) values (wid, c.id, crypt('admin', gen_salt('bf')), true);
    made := made + 1;
  end loop;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('created', made));
end $$;
revoke all on function bootstrap_admin() from public, anon, authenticated;
grant execute on function bootstrap_admin() to service_role;

create or replace function role_can(p_role text, p_action text) returns text
language sql immutable set search_path = public as $$
  select coalesce(
    (select m.access
       from (values
         ('cashier', 'view.sell', 'yes'),
         ('cashier', 'sell', 'yes'),
         ('cashier', 'holdCart', 'yes'),
         ('cashier', 'returnWithInvoice', 'yes'),
         ('cashier', 'discountWithinLimit', 'yes'),
         ('cashier', 'customerReceipt', 'yes'),
         ('cashier', 'addCustomer', 'yes'),
         ('cashier', 'recordExpense', 'yes'),
         ('cashier', 'cashTransfer', 'yes'),
         ('storekeeper', 'view.products', 'yes'),
         ('storekeeper', 'view.categories', 'yes'),
         ('storekeeper', 'view.purchases', 'yes'),
         ('storekeeper', 'view.stock', 'yes'),
         ('storekeeper', 'receivePurchase', 'yes'),
         ('storekeeper', 'stockAdjustment', 'yes'),
         ('storekeeper', 'editProductData', 'yes'),
         ('storekeeper', 'purchaseReturnWithoutInvoice', 'yes'),
         ('storekeeper', 'addProduct', 'yes')
       ) as m (role, action, access)
      where m.role = p_role and m.action = p_action),
    case when p_role = 'manager' then 'yes' else 'no' end)
$$;

create or replace function worker_can(p_worker uuid, p_action text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  w workers;
  perms jsonb;
begin
  select * into w from workers where id = p_worker;
  if not found then
    return 'no';
  end if;
  if w.role = 'manager' and p_action in ('view.workers', 'manageUsers', 'manageGroups', 'view.settings', 'settings') then
    return 'yes';
  end if;
  if w.group_id is not null then
    select g.permissions into perms from permission_groups g where g.id = w.group_id and g.deleted_at is null;
    if found then
      return case coalesce(perms ->> p_action, 'no') when 'yes' then 'yes' else 'no' end;
    end if;
  end if;
  return role_can(w.role, p_action);
end $$;

create or replace function ingest_stock_adjustment_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  adj jsonb := p_rec - 'lines' - 'stock_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  adj_id uuid := (p_rec ->> 'id')::uuid;
  reason text := p_rec ->> 'reason_code';
  wh uuid := (p_rec ->> 'warehouse_id')::uuid;
  e jsonb;
  m jsonb;
  pr products;
  delta bigint;
  adj_value bigint := 0;
  threshold bigint;
  fixed_lines jsonb := '[]';
  fixed_smov jsonb := '[]';
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-ADJ-%' then
    raise exception 'E_VALIDATION:رقم التسوية لا يخص الجهاز';
  end if;
  if reason not in ('count', 'damaged', 'lost', 'found', 'other') then
    raise exception 'E_VALIDATION:سبب التسوية مطلوب';
  end if;
  if jsonb_array_length(lines) = 0 or jsonb_array_length(lines) <> jsonb_array_length(smov) then
    raise exception 'E_VALIDATION:تسوية غير مكتملة';
  end if;
  if not exists (select 1 from warehouses w where w.id = wh and w.company_id = p_company) then
    raise exception 'E_VALIDATION:مخزن غير صالح';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    delta := (e ->> 'qty_delta')::bigint;
    select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company and type = 'stock';
    if not found or delta = 0 or (e ->> 'adjustment_id')::uuid is distinct from adj_id then
      raise exception 'E_VALIDATION:سطر تسوية غير صالح';
    end if;
    if (reason in ('damaged', 'lost') and delta > 0) or (reason = 'found' and delta < 0) then
      raise exception 'E_VALIDATION:الكمية لا تناسب السبب';
    end if;
    select x into m from jsonb_array_elements(smov) x where x ->> 'product_id' = pr.id::text and (x ->> 'qty')::bigint = delta and x ->> 'doc_id' = adj_id::text and x ->> 'doc_type' = 'stock_adjustment' and (x ->> 'warehouse_id')::uuid = wh limit 1;
    if m is null then
      raise exception 'E_VALIDATION:حركة المخزون لا تطابق التسوية';
    end if;
    adj_value := adj_value + abs(delta) * coalesce(pr.unit_cost, 0) / 1000;
    fixed_lines := fixed_lines || jsonb_build_array(e || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
    fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
  end loop;
  select coalesce((select (value #>> '{}')::bigint from settings where company_id = p_company and key = 'stock.approvalAbove' and deleted_at is null), 50000) into threshold;
  if worker_can(p_worker.id, 'stockAdjustmentOverLimit') <> 'yes' and adj_value > threshold then
    raise exception 'E_FORBIDDEN:التسوية فوق الحد مش مسموحة';
  end if;
  perform ingest_insert('stock_adjustments', adj, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('stock_adjustment_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
end $$;

create or replace function ingest_shift_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur shifts;
  sid uuid := (p_rec ->> 'id')::uuid;
  expected bigint;
  counted bigint;
  diff bigint;
  limit_v bigint;
  e jsonb;
begin
  select * into cur from shifts where id = sid;
  if not found then
    if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-SHF-%' then
      raise exception 'E_VALIDATION:رقم الوردية لا يخص الجهاز';
    end if;
    if p_rec ->> 'status' <> 'open' then
      raise exception 'E_VALIDATION:وردية لم تُفتح';
    end if;
    if exists (select 1 from shifts where company_id = p_company and status = 'open') then
      raise exception 'E_VALIDATION:فيه وردية مفتوحة';
    end if;
    perform ingest_insert('shifts', p_rec - 'counted_total' - 'counted_breakdown' - 'expected_total' - 'variance' - 'closed_at' - 'close_note' - 'approved_by', p_company, p_device);
    return;
  end if;
  if cur.company_id is distinct from p_company then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if p_rec ->> 'status' <> 'closed' then
    return; -- a re-sent opening
  end if;
  if cur.status = 'closed' then
    if cur.counted_total is distinct from (p_rec ->> 'counted_total')::bigint then
      raise exception 'E_VALIDATION:الوردية اتقفلت قبل كده';
    end if;
    return; -- a re-sent close
  end if;
  select cur.opening_float + coalesce(sum(amount), 0) into expected from cash_movements where cash_account_id = cur.cash_account_id and deleted_at is null and occurred_at >= cur.opened_at and occurred_at <= (p_rec ->> 'closed_at')::timestamptz;
  select coalesce(sum((x ->> 'value')::bigint * (x ->> 'count')::bigint), 0) into counted
    from jsonb_array_elements(coalesce(p_rec -> 'counted_breakdown', '[]')) x;
  if (p_rec ->> 'expected_total')::bigint <> expected or (p_rec ->> 'counted_total')::bigint <> counted then
    raise exception 'E_VALIDATION:حساب الوردية لا يطابق الحركات';
  end if;
  diff := counted - expected;
  if (p_rec ->> 'variance')::bigint <> diff then
    raise exception 'E_VALIDATION:الفرق غير صحيح';
  end if;
  select coalesce((select (s.value #>> '{}')::bigint from settings s where s.company_id = p_company and s.key = 'shift.varianceAbove' and s.deleted_at is null), 2000) into limit_v;
  if abs(diff) > limit_v and coalesce(p_rec ->> 'close_note', '') = '' then
    raise exception 'E_FORBIDDEN:الفرق محتاج تعليق';
  end if;
  update shifts set closed_at = (p_rec ->> 'closed_at')::timestamptz, counted_total = counted, counted_breakdown = p_rec -> 'counted_breakdown',
         expected_total = expected, variance = diff, close_note = nullif(p_rec ->> 'close_note', ''),
         approved_by = nullif(p_rec ->> 'approved_by', '')::uuid, status = 'closed', version = version + 1, updated_at = now()
   where id = sid;
end $$;
