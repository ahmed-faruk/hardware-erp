-- Money brought into the shop's box from outside it, or taken out of it (owner decision 2026-11-01): a fixed cash place «خارج الخزنة»
-- that a transfer can come from or go to. It is not a box: no shift, no count, and the safe report never reads it.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'cash_accounts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%card_clearing%';
  if c is not null then execute format('alter table cash_accounts drop constraint %I', c); end if;
end $$;
alter table cash_accounts add constraint cash_accounts_kind_check
  check (kind in ('drawer', 'safe', 'bank', 'wallet', 'card_clearing', 'outside'));

insert into cash_accounts (id, company_id, name, kind)
select gen_random_uuid(), co.id, 'خارج الخزنة', 'outside' from companies co
 where not exists (select 1 from cash_accounts a where a.company_id = co.id and a.kind = 'outside' and a.deleted_at is null);
