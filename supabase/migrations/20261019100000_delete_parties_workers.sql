-- Deleting a customer, supplier or worker (owner decision 2026-10-18) is a soft delete (deleted_at), refused while money is open:
-- a customer or supplier only at balance 0; a worker not while an advance (or what the last salary could not cover) is still owed.

create or replace function refuse_open_party_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and (select coalesce(sum(l.amount), 0) from party_ledger l
           where l.company_id = new.company_id and l.party_type = tg_argv[0] and l.party_id = new.id and l.deleted_at is null) <> 0 then
    raise exception 'E_VALIDATION:عليه رصيد، لازم يبقى صفر الأول';
  end if;
  return new;
end $$;
create trigger customers_refuse_open_delete before update on customers for each row execute function refuse_open_party_delete('customer');
create trigger suppliers_refuse_open_delete before update on suppliers for each row execute function refuse_open_party_delete('supplier');

create or replace function refuse_owed_worker_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare last_salary payroll_entries;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    select * into last_salary from payroll_entries x
     where x.employee_id = new.id and x.kind = 'salary' and x.status = 'posted' and x.deleted_at is null
     order by x.issued_at desc limit 1;
    if coalesce(last_salary.carry_out, 0) > 0 or exists (
         select 1 from payroll_entries x
          where x.employee_id = new.id and x.kind = 'advance' and x.status = 'posted' and x.deleted_at is null
            and (last_salary.id is null or x.issued_at > last_salary.issued_at)) then
      raise exception 'E_VALIDATION:عليه سلف لسه ما اتخصمتش';
    end if;
  end if;
  return new;
end $$;
create trigger workers_refuse_owed_delete before update on workers for each row execute function refuse_owed_worker_delete();
