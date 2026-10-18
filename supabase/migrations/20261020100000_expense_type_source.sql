-- Owner decision 2026-10-19: the only expense type is «مصروفات محل» («مشتريات» is retired like the old types), and an expense is
-- paid either from the box (source 'safe': one cash movement, as before) or from outside the box (source 'owner': no account, no cash).

alter table expenses add column source text not null default 'safe' check (source in ('safe', 'owner'));

create or replace function apply_expense_types() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- 1. each company has the shop type (an existing one is reused, not duplicated)
  insert into expense_categories (id, company_id, name)
  select gen_random_uuid(), c.id, 'مصروفات محل'
  from companies c
  where not exists (
    select 1 from expense_categories x
    where x.company_id = c.id and x.name = 'مصروفات محل' and x.deleted_at is null
  );
  -- 2. every other type is retired (updated_at / version move, so every device pulls the change)
  update expense_categories
     set deleted_at = now(), updated_at = now(), version = version + 1
   where deleted_at is null and name <> 'مصروفات محل';
end $$;
revoke all on function apply_expense_types() from public, anon, authenticated;

select apply_expense_types();

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
  if coalesce(p_rec ->> 'source', 'safe') not in ('safe', 'owner') then
    raise exception 'E_VALIDATION:مصدر المصروف غير صالح';
  end if;
  -- paid from outside the box: no account and no cash movement
  if p_rec ->> 'source' = 'owner' then
    if p_rec ->> 'cash_account_id' is not null or jsonb_array_length(cmov) <> 0 then
      raise exception 'E_VALIDATION:المصروف من خارج الخزنة مالوش حركة نقدية';
    end if;
    perform ingest_insert('expenses', ex, p_company, p_device);
    return;
  end if;
  select * into acct from cash_accounts where id = (p_rec ->> 'cash_account_id')::uuid and company_id = p_company;
  if not found then
    raise exception 'E_VALIDATION:حساب نقدية غير صالح';
  end if;
  if worker_can(p_worker.id, 'expenseAnyAccount') <> 'yes' and not ((acct.kind = 'drawer' and acct.owner_device_id = p_device) or acct.kind = 'safe') then
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
