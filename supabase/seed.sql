-- Local development seed. FAKE data only; credentials below work on `supabase start` and nowhere else.
-- Device accounts: <prefix>@devices.test.local / local-test-password
-- Two companies exist so isolation tests can prove company A never sees company B.

create or replace function pg_temp.make_device_user(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          crypt('local-test-password', gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), p_id, p_id::text, jsonb_build_object('sub', p_id::text, 'email', p_email), 'email', now(), now(), now());
end $$;

-- company A ---------------------------------------------------------------
insert into companies (id, company_id, name) values ('a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-000000000001', 'Test Shop A');
insert into branches (id, company_id, name) values ('a0000000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-000000000001', 'Main');
insert into warehouses (id, company_id, branch_id, name, kind) values
  ('a0000000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000b1', 'Main', 'main');
insert into workers (id, company_id, name, role) values
  ('a0000000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-000000000001', 'Cashier A', 'cashier'),
  ('a0000000-0000-7000-8000-0000000000d2', 'a0000000-0000-7000-8000-000000000001', 'Storekeeper A', 'storekeeper'),
  ('a0000000-0000-7000-8000-0000000000d3', 'a0000000-0000-7000-8000-000000000001', 'Manager A', 'manager');
select pg_temp.make_device_user('a0000000-0000-7000-8000-0000000000e1', 'k1@devices.test.local');
select pg_temp.make_device_user('a0000000-0000-7000-8000-0000000000e2', 'k2@devices.test.local');
select pg_temp.make_device_user('a0000000-0000-7000-8000-0000000000e3', 'm1@devices.test.local');
insert into devices (id, company_id, branch_id, auth_user_id, name, prefix, kind, max_role) values
  ('a0000000-0000-7000-8000-0000000000f1', 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-0000000000e1', 'Counter 1', 'K1', 'pc', 'manager'),
  ('a0000000-0000-7000-8000-0000000000f2', 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-0000000000e2', 'Counter 2', 'K2', 'pc', 'manager'),
  ('a0000000-0000-7000-8000-0000000000f3', 'a0000000-0000-7000-8000-000000000001', 'a0000000-0000-7000-8000-0000000000b1', 'a0000000-0000-7000-8000-0000000000e3', 'Cashier phone', 'M1', 'mobile', 'cashier');
insert into cash_accounts (id, company_id, name, kind, owner_device_id) values
  ('a0000000-0000-7000-8000-000000000a11', 'a0000000-0000-7000-8000-000000000001', 'Drawer K1', 'drawer', 'a0000000-0000-7000-8000-0000000000f1'),
  ('a0000000-0000-7000-8000-000000000a12', 'a0000000-0000-7000-8000-000000000001', 'Drawer K2', 'drawer', 'a0000000-0000-7000-8000-0000000000f2'),
  ('a0000000-0000-7000-8000-000000000a13', 'a0000000-0000-7000-8000-000000000001', 'Main safe', 'safe', null);
insert into expense_categories (id, company_id, name) values
  ('a0000000-0000-7000-8000-000000000e01', 'a0000000-0000-7000-8000-000000000001', 'Transport');
insert into customers (id, company_id, name, phone, credit_limit) values
  ('a0000000-0000-7000-8000-000000000c01', 'a0000000-0000-7000-8000-000000000001', 'Test Customer', '01000000000', 100000000);
insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals)
select ('a0000000-0000-7000-8000-00000000' || lpad(g::text, 4, '0'))::uuid, 'a0000000-0000-7000-8000-000000000001',
       'P' || lpad(g::text, 3, '0'), 'Test product ' || g, 'pcs', 1000 + g * 250, 600 + g * 100, 0
from generate_series(1, 20) g;

-- company B (isolation tests) ---------------------------------------------
insert into companies (id, company_id, name) values ('b0000000-0000-7000-8000-000000000001', 'b0000000-0000-7000-8000-000000000001', 'Test Shop B');
insert into branches (id, company_id, name) values ('b0000000-0000-7000-8000-0000000000b1', 'b0000000-0000-7000-8000-000000000001', 'Main');
insert into workers (id, company_id, name, role) values
  ('b0000000-0000-7000-8000-0000000000d3', 'b0000000-0000-7000-8000-000000000001', 'Manager B', 'manager');
select pg_temp.make_device_user('b0000000-0000-7000-8000-0000000000e1', 'b1@devices.test.local');
insert into devices (id, company_id, branch_id, auth_user_id, name, prefix, kind, max_role) values
  ('b0000000-0000-7000-8000-0000000000f1', 'b0000000-0000-7000-8000-000000000001', 'b0000000-0000-7000-8000-0000000000b1', 'b0000000-0000-7000-8000-0000000000e1', 'Counter B', 'B1', 'pc', 'manager');
insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost) values
  ('b0000000-0000-7000-8000-000000000001', 'b0000000-0000-7000-8000-000000000001', 'B001', 'Other shop product', 'pcs', 5000, 3000);
