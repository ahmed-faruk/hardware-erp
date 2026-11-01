begin;
select plan(2);

select ok(
  exists (select 1 from cash_accounts where company_id = 'a0000000-0000-7000-8000-000000000001' and kind = 'outside' and deleted_at is null),
  'the shop has the cash place «outside the box»');
select lives_ok(
  $$insert into cash_accounts (id, company_id, name, kind) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'x', 'outside')$$,
  'the kind outside is allowed');

select * from finish();
rollback;
