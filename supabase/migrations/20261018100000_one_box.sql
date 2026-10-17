-- One box: the shop has a single cash account «الخزنة»; drawers are retired (their balance moves into the safe by a posted transfer).
-- One shift for the whole shop: any device opens into it and any device closes it; expected = float + every cash movement on the box while it was open.

do $$
declare c record; d record; safe_id uuid; bal bigint; n int; tid uuid;
begin
  for c in select id from companies loop
    select id into safe_id from cash_accounts where company_id = c.id and kind = 'safe' and deleted_at is null order by created_at limit 1;
    if safe_id is null then
      safe_id := gen_random_uuid();
      insert into cash_accounts (id, company_id, name, kind) values (safe_id, c.id, 'الخزنة', 'safe');
    end if;
    update cash_accounts set name = 'الخزنة', updated_at = now(), version = version + 1 where id = safe_id;
    n := 0;
    for d in select id from cash_accounts where company_id = c.id and kind = 'drawer' and deleted_at is null loop
      select coalesce(sum(amount), 0) into bal from cash_movements where cash_account_id = d.id and deleted_at is null;
      if bal <> 0 then
        n := n + 1; tid := gen_random_uuid();
        insert into cash_transfers (id, company_id, number, issued_at, status, from_account_id, to_account_id, amount)
        values (tid, c.id, 'MIG-TRF-' || lpad(n::text, 6, '0'), now(), 'posted',
                case when bal > 0 then d.id else safe_id end, case when bal > 0 then safe_id else d.id end, abs(bal));
        insert into cash_movements (id, company_id, cash_account_id, amount, method, doc_type, doc_id, occurred_at) values
          (gen_random_uuid(), c.id, d.id, -bal, 'cash', 'cash_transfer', tid, now()),
          (gen_random_uuid(), c.id, safe_id, bal, 'cash', 'cash_transfer', tid, now());
      end if;
      update shifts set cash_account_id = safe_id, updated_at = now(), version = version + 1 where cash_account_id = d.id and status = 'open';
      update cash_accounts set deleted_at = now(), updated_at = now(), version = version + 1 where id = d.id;
    end loop;
  end loop;
end $$;

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

create or replace function ingest_cash_transfer_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  tr jsonb := p_rec - 'cash_movements';
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  tid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  src cash_accounts;
  dst cash_accounts;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-XFR-%' then
    raise exception 'E_VALIDATION:رقم التوريد لا يخص الجهاز';
  end if;
  select * into src from cash_accounts where id = (p_rec ->> 'from_account_id')::uuid and company_id = p_company;
  select * into dst from cash_accounts where id = (p_rec ->> 'to_account_id')::uuid and company_id = p_company;
  if amount <= 0 or src.id is null or dst.id is null or src.id = dst.id then
    raise exception 'E_VALIDATION:توريد غير صالح';
  end if;
  if worker_can(p_worker.id, 'cashTransferAny') <> 'yes' and not (((src.kind = 'drawer' and src.owner_device_id = p_device) or src.kind = 'safe') and dst.kind in ('safe', 'bank', 'wallet')) then
    raise exception 'E_FORBIDDEN:التوريد من درج الجهاز للخزنة بس';
  end if;
  if jsonb_array_length(cmov) <> 2
     or coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 1) <> 0
     or not exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid = src.id and (x ->> 'amount')::bigint = -amount)
     or not exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid = dst.id and (x ->> 'amount')::bigint = amount) then
    raise exception 'E_VALIDATION:حركات التوريد لا تطابق المبلغ';
  end if;
  for e in select * from jsonb_array_elements(cmov) loop
    if e ->> 'doc_id' is distinct from tid::text or e ->> 'doc_type' <> 'cash_transfer' then
      raise exception 'E_VALIDATION:حركة لا تخص التوريد';
    end if;
  end loop;
  perform ingest_insert('cash_transfers', tr, p_company, p_device);
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
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
  if abs(diff) > limit_v
     and (coalesce(p_rec ->> 'close_note', '') = ''
          or not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'shiftVarianceApprove') = 'yes' and a.company_id = p_company and a.active)) then
    raise exception 'E_FORBIDDEN:الفرق محتاج موافقة المدير وتعليق';
  end if;
  update shifts set closed_at = (p_rec ->> 'closed_at')::timestamptz, counted_total = counted, counted_breakdown = p_rec -> 'counted_breakdown',
         expected_total = expected, variance = diff, close_note = nullif(p_rec ->> 'close_note', ''),
         approved_by = nullif(p_rec ->> 'approved_by', '')::uuid, status = 'closed', version = version + 1, updated_at = now()
   where id = sid;
end $$;
