-- Expense types are only «مشتريات» and «مصروفات محل». Old types stay on old expenses (the reports still show their names)
-- but are retired: devices stop offering them and the server refuses new expenses on them.

create function apply_expense_types() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- 1. each company has the two types (a name that already exists is reused, not duplicated)
  insert into expense_categories (id, company_id, name)
  select gen_random_uuid(), c.id, n.name
  from companies c
  cross join (values ('مشتريات'), ('مصروفات محل')) as n (name)
  where not exists (
    select 1 from expense_categories x
    where x.company_id = c.id and x.name = n.name and x.deleted_at is null
  );

  -- 2. every other type is retired (updated_at / server_seq move, so every device pulls the change)
  update expense_categories
     set deleted_at = now(), updated_at = now(), version = version + 1
   where deleted_at is null and name not in ('مشتريات', 'مصروفات محل');
end $$;
revoke all on function apply_expense_types() from public, anon, authenticated;

select apply_expense_types();

-- 3. devices no longer create or rename types
update sync_tables set push_action = null where table_name = 'expense_categories';

-- 4. an expense on a retired type is refused (copy of the latest ingest_expense_bundle with one more check)
create or replace function ingest_expense_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ex jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  eid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  acct cash_accounts;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-EXP-%' then
    raise exception 'E_VALIDATION:رقم المصروف لا يخص الجهاز';
  end if;
  if amount <= 0 or not exists (select 1 from expense_categories c where c.id = (p_rec ->> 'category_id')::uuid and c.company_id = p_company and c.deleted_at is null) then
    raise exception 'E_VALIDATION:مصروف غير صالح';
  end if;
  select * into acct from cash_accounts where id = (p_rec ->> 'cash_account_id')::uuid and company_id = p_company;
  if not found then
    raise exception 'E_VALIDATION:حساب نقدية غير صالح';
  end if;
  if worker_can(p_worker.id, 'expenseAnyAccount') <> 'yes' and not (acct.kind = 'drawer' and acct.owner_device_id = p_device) then
    raise exception 'E_FORBIDDEN:المصروف من درج الجهاز بس';
  end if;
  if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> -amount
     or (cmov -> 0 ->> 'cash_account_id')::uuid <> acct.id
     or cmov -> 0 ->> 'doc_id' is distinct from eid::text or cmov -> 0 ->> 'doc_type' <> 'expense' then
    raise exception 'E_VALIDATION:حركة النقدية لا تطابق المصروف';
  end if;
  perform ingest_insert('expenses', ex, p_company, p_device);
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;
