begin;
select plan(19);

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.code(j jsonb) returns text language sql as $$ select j -> 'error' ->> 'code' $$;

-- a brand-new browser: its own auth user, no device yet
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '0190f000-0000-7000-8000-0000000000aa', 'authenticated', 'authenticated', 'new@devices.test.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', '', '', '', '');
-- workers: a manager (d3) with a login, a cashier (d1) with a login, the storekeeper (d2) without one
update workers set username = 'boss' where id = 'a0000000-0000-7000-8000-0000000000d3';
update workers set username = 'cash' where id = 'a0000000-0000-7000-8000-0000000000d1';
insert into worker_credentials (worker_id, company_id, password_hash, must_change) values
  ('a0000000-0000-7000-8000-0000000000d3', 'a0000000-0000-7000-8000-000000000001', crypt('secret1', gen_salt('bf')), true),
  ('a0000000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-000000000001', crypt('secret2', gen_salt('bf')), false);

select pg_temp.act_as('0190f000-0000-7000-8000-0000000000aa');
select is(pg_temp.code(login_device('boss', 'wrong', 'PC', 'pc')), 'E_LOGIN', 'a wrong password is refused');
select is((login_device('BOSS ', 'secret1', 'PC', 'pc') -> 'data' ->> 'must_change')::boolean, true, 'a right password registers the device and says the password must change (username is case and space tolerant)');
select is((login_device('boss', 'secret1', 'PC', 'pc') -> 'data' ->> 'prefix'), (login_device('boss', 'secret1', 'PC', 'pc') -> 'data' ->> 'prefix'), 'the same browser logging in again keeps its device');
reset role;
select is((select count(*)::int from devices where auth_user_id = '0190f000-0000-7000-8000-0000000000aa' and max_role = 'manager'), 1, 'one manager device was created for the browser');
select ok((select prefix from devices where auth_user_id = '0190f000-0000-7000-8000-0000000000aa') ~ '^K[0-9A-Z]+$', 'its prefix is K + a code');

-- lockout: 5 wrong tries lock the username for 15 minutes
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(verify_worker_login('cash', 'nope')), 'E_LOGIN', 'verify: wrong password');
select verify_worker_login('cash', 'nope'); select verify_worker_login('cash', 'nope'); select verify_worker_login('cash', 'nope'); select verify_worker_login('cash', 'nope');
select is(pg_temp.code(verify_worker_login('cash', 'secret2')), 'E_LOCKED', 'after 5 wrong tries even the right password is locked out');
reset role;
update worker_credentials set locked_until = null, failed = 0 where worker_id = 'a0000000-0000-7000-8000-0000000000d1';
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select is((verify_worker_login('cash', 'secret2') -> 'data' ->> 'worker_id'), 'a0000000-0000-7000-8000-0000000000d1', 'verify: the right password gives the worker');
reset role;
-- another company's device cannot verify company A's worker
select pg_temp.act_as('b0000000-0000-7000-8000-0000000000e1');
select is(pg_temp.code(verify_worker_login('boss', 'secret1')), 'E_LOGIN', 'verify from another company: refused');
reset role;

-- set_worker_login
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select set_worker_login('a0000000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-0000000000d3', null, 'abcdef')$$, 'P0001', 'E_FORBIDDEN:غير مسموح', 'a cashier cannot change another worker''s password');
select is((set_worker_login('a0000000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-0000000000d1', null, 'newpass1') -> 'ok')::text, 'true', 'a worker changes their own password');
select is((set_worker_login('a0000000-0000-7000-8000-0000000000d3', 'a0000000-0000-7000-8000-0000000000d2', 'store', 'storepw1') -> 'data' ->> 'username'), 'store', 'a manager gives the storekeeper a login');
select throws_ok($$select set_worker_login('a0000000-0000-7000-8000-0000000000d3', 'a0000000-0000-7000-8000-0000000000d2', null, 'abc')$$, 'P0001', 'E_VALIDATION:كلمة السر 6 حروف على الأقل', 'a short password is refused');
reset role;
select is((select must_change from worker_credentials where worker_id = 'a0000000-0000-7000-8000-0000000000d1'), false, 'a changed password clears must_change');
select is((select substr(password_hash, 1, 7) from worker_credentials where worker_id = 'a0000000-0000-7000-8000-0000000000d1'), '$2a$12$', 'a changed password is hashed with bcrypt cost 12');

-- credentials are never readable by devices
select pg_temp.act_as('a0000000-0000-7000-8000-0000000000e1');
select throws_ok($$select * from worker_credentials$$, '42501', null, 'worker_credentials is not readable by a device');
reset role;
-- bootstrap_admin (service role): once per company without a login
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select (bootstrap_admin() -> 'data' ->> 'created')::int), 1, 'bootstrap_admin creates the admin of the company that has no login (B)');
select is((select (bootstrap_admin() -> 'data' ->> 'created')::int), 0, 'and a second call creates nothing');
reset role;
select is(role_can('cashier', 'discountOverLimit'), 'no', 'the pin level is gone: a cashier has no discount over the limit');

select * from finish();
rollback;
