-- Deleting an expense (permission voidExpense) or a payroll advance/deduction (managePayroll) is a void document (owner decision 2026-10-18):
-- the cash comes back into the box of the shift open now; a deduction of a paid month or an advance a later salary took cannot be voided.
-- ingest_void_bundle checks the right permission for every target type, so the table-level push check no longer requires `void`.

update sync_tables set push_action = 'any' where table_name = 'voids';

create or replace function ingest_void_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  vd jsonb := p_rec - 'stock_movements' - 'party_ledger' - 'cash_movements';
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  void_id uuid := (p_rec ->> 'id')::uuid;
  target uuid := (p_rec ->> 'target_id')::uuid;
  inv sales_invoices;
  pinv purchase_invoices;
  open_shift shifts;
  pc record;
  ret sales_returns;
  ex expenses;
  pe payroll_entries;
  e jsonb;
begin
  if p_rec ->> 'target_type' not in ('sales_invoice', 'sales_return', 'purchase_invoice', 'expense', 'payroll_entry') then
    raise exception 'E_VALIDATION:مستند إلغاء غير صالح';
  end if;
  if worker_can(p_worker.id, case p_rec ->> 'target_type' when 'sales_return' then 'voidReturn' when 'purchase_invoice' then 'voidPurchase'
                                  when 'expense' then 'voidExpense' when 'payroll_entry' then 'managePayroll' else 'void' end) <> 'yes' then
    raise exception 'E_FORBIDDEN:الحذف للمدير فقط';
  end if;
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-VOID-%' then
    raise exception 'E_VALIDATION:مستند إلغاء غير صالح';
  end if;
  if coalesce(p_rec ->> 'reason', '') = '' then
    raise exception 'E_VALIDATION:سبب الإلغاء مطلوب';
  end if;
  if p_rec ->> 'target_type' = 'sales_invoice' then
    select * into inv from sales_invoices where id = target and company_id = p_company;
    if not found or inv.status <> 'posted' then
      raise exception 'E_VALIDATION:الفاتورة غير صالحة للإلغاء';
    end if;
    -- a voided return gave its goods and money back already: only a posted return blocks the void
    if exists (select 1 from sales_returns where original_invoice_id = target and company_id = p_company and status = 'posted') then
      raise exception 'E_VALIDATION:الفاتورة عليها مرتجع';
    end if;
    -- the cash share goes back out of the drawer of the shift open on the deleting device: one row per original row, all on that drawer
    if jsonb_array_length(cmov) > 0 then
      select * into open_shift from shifts where id = nullif(p_rec ->> 'shift_id', '')::uuid and company_id = p_company and status = 'open';
      if not found or exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid is distinct from open_shift.cash_account_id) then
        raise exception 'E_VALIDATION:الفلوس لازم ترجع من درج وردية مفتوحة';
      end if;
      if (select coalesce(sum((x ->> 'amount')::bigint), 0) from jsonb_array_elements(cmov) x)
         + (select coalesce(sum(amount), 0) from cash_movements where doc_id = target) <> 0 then
        raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
      end if;
    end if;
  elsif p_rec ->> 'target_type' = 'sales_return' then
    select * into ret from sales_returns where id = target and company_id = p_company;
    if not found or ret.status <> 'posted' then
      raise exception 'E_VALIDATION:المرتجع غير صالح للإلغاء';
    end if;
    -- cash goes back into the drawer of an open shift: the same drawer that paid it out
    if jsonb_array_length(cmov) > 0 and not exists (
         select 1 from shifts sh
          where sh.id = nullif(p_rec ->> 'shift_id', '')::uuid and sh.company_id = p_company and sh.status = 'open'
            and not exists (select 1 from jsonb_array_elements(cmov) x where (x ->> 'cash_account_id')::uuid is distinct from sh.cash_account_id)) then
      raise exception 'E_VALIDATION:الفلوس لازم ترجع لدرج وردية مفتوحة';
    end if;
  elsif p_rec ->> 'target_type' = 'expense' then
    select * into ex from expenses where id = target and company_id = p_company;
    if not found or ex.status <> 'posted' or ex.is_legacy then
      raise exception 'E_VALIDATION:المصروف غير صالح للحذف';
    end if;
    -- the money comes back into the box of the shift open now
    if jsonb_array_length(cmov) > 0 and not exists (
         select 1 from shifts sh where sh.id = nullif(p_rec ->> 'shift_id', '')::uuid and sh.company_id = p_company and sh.status = 'open') then
      raise exception 'E_VALIDATION:الفلوس لازم ترجع لوردية مفتوحة';
    end if;
  elsif p_rec ->> 'target_type' = 'payroll_entry' then
    select * into pe from payroll_entries where id = target and company_id = p_company;
    if not found or pe.status <> 'posted' or pe.is_legacy or pe.kind not in ('advance', 'deduction') then
      raise exception 'E_VALIDATION:السند غير صالح للحذف';
    end if;
    if pe.kind = 'deduction' and exists (
         select 1 from payroll_entries x where x.employee_id = pe.employee_id and x.kind = 'salary' and x.month = pe.month
            and x.status = 'posted' and x.deleted_at is null) then
      raise exception 'E_VALIDATION:الشهر ده اتصرف مرتبه';
    end if;
    if pe.kind = 'advance' and exists (
         select 1 from payroll_entries x where x.employee_id = pe.employee_id and x.kind = 'salary' and x.issued_at > pe.issued_at
            and x.status = 'posted' and x.deleted_at is null) then
      raise exception 'E_VALIDATION:السلفة اتخصمت من مرتب';
    end if;
    if jsonb_array_length(cmov) > 0 and not exists (
         select 1 from shifts sh where sh.id = nullif(p_rec ->> 'shift_id', '')::uuid and sh.company_id = p_company and sh.status = 'open') then
      raise exception 'E_VALIDATION:الفلوس لازم ترجع لوردية مفتوحة';
    end if;
  else
    select * into pinv from purchase_invoices where id = target and company_id = p_company;
    if not found or pinv.status <> 'posted' or pinv.is_legacy then
      raise exception 'E_VALIDATION:الفاتورة غير صالحة للحذف';
    end if;
    if exists (
         select 1 from purchase_return_lines l
           join purchase_returns r on r.id = l.return_id
           join purchase_invoice_lines il on il.id = l.original_line_id
          where il.invoice_id = target and r.status = 'posted' and r.company_id = p_company) then
      raise exception 'E_VALIDATION:الفاتورة عليها مرتجع';
    end if;
    -- every product must still have at least what the invoice brought, in the warehouse it went to
    if exists (
         select 1 from (select product_id, warehouse_id, sum(qty) q from stock_movements where doc_id = target group by 1, 2) o
          where (select coalesce(sum(s.qty), 0) from stock_movements s
                  where s.company_id = p_company and s.product_id = o.product_id and s.warehouse_id = o.warehouse_id) < o.q) then
      raise exception 'E_VALIDATION:جزء من البضاعة اتباع';
    end if;
  end if;
  -- the reversing rows must be exactly the negation of what the document wrote: same keys, opposite totals, same row counts
  if (select count(*) from stock_movements where doc_id = target) <> jsonb_array_length(smov)
     or (select count(*) from party_ledger where doc_id = target) <> jsonb_array_length(pled)
     or (select count(*) from cash_movements where doc_id = target) <> jsonb_array_length(cmov) then
    raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
  end if;
  if exists (
       select 1 from (select product_id, warehouse_id, sum(qty) q from stock_movements where doc_id = target group by 1, 2) o
       full join (select (x ->> 'product_id')::uuid product_id, (x ->> 'warehouse_id')::uuid warehouse_id, sum((x ->> 'qty')::bigint) q from jsonb_array_elements(smov) x group by 1, 2) r
         using (product_id, warehouse_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0)
     or exists (
       select 1 from (select party_id, sum(amount) q from party_ledger where doc_id = target group by 1) o
       full join (select (x ->> 'party_id')::uuid party_id, sum((x ->> 'amount')::bigint) q from jsonb_array_elements(pled) x group by 1) r using (party_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0)
     or (p_rec ->> 'target_type' <> 'sales_invoice' and exists (
       select 1 from (select cash_account_id, sum(amount) q from cash_movements where doc_id = target group by 1) o
       full join (select (x ->> 'cash_account_id')::uuid cash_account_id, sum((x ->> 'amount')::bigint) q from jsonb_array_elements(cmov) x group by 1) r using (cash_account_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0)) then
    raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
  end if;
  for e in select * from jsonb_array_elements(smov || pled || cmov) loop
    if e ->> 'doc_id' is distinct from void_id::text or e ->> 'doc_type' <> 'void' then
      raise exception 'E_VALIDATION:حركة لا تخص الإلغاء';
    end if;
  end loop;
  -- a deleted purchase: the average cost is worked out again without it (before the reversing rows change the stock)
  if p_rec ->> 'target_type' = 'purchase_invoice' then
    for pc in select product_id, sum(qty)::bigint oq, sum(qty * unit_cost)::bigint ov from stock_movements where doc_id = target group by product_id loop
      update products set
        unit_cost = reverse_moving_average(
          (select coalesce(sum(s.qty), 0)::bigint from stock_movements s where s.company_id = p_company and s.product_id = pc.product_id),
          unit_cost, pc.oq,
          case when pc.oq > 0 then (pc.ov * 2 + pc.oq) / (2 * pc.oq) else unit_cost end),
        updated_at = now(), version = version + 1
       where id = pc.product_id and company_id = p_company;
    end loop;
  end if;
  perform ingest_insert('voids', vd, p_company, p_device);
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
  if p_rec ->> 'target_type' = 'sales_invoice' then
    update sales_invoices set status = 'voided', voided_by = void_id where id = target;
  elsif p_rec ->> 'target_type' = 'sales_return' then
    update sales_returns set status = 'voided', voided_by = void_id where id = target;
  elsif p_rec ->> 'target_type' = 'expense' then
    update expenses set status = 'voided', voided_by = void_id where id = target;
  elsif p_rec ->> 'target_type' = 'payroll_entry' then
    update payroll_entries set status = 'voided', voided_by = void_id where id = target;
  else
    update purchase_invoices set status = 'voided', voided_by = void_id where id = target;
  end if;
end $$;

create or replace function report_exceptions_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select (jsonb_build_object(
    'from', p_from, 'to', p_to,
    'voids', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'at', v.issued_at, 'reason', v.reason, 'worker', coalesce(w.name, '—'),
        'target_type', v.target_type, 'target_number', coalesce(si.number, sr.number, pi.number, ex.number, pe.number, '—')) order by v.issued_at)
      from voids v left join workers w on w.id = v.worker_id
      left join sales_invoices si on v.target_type = 'sales_invoice' and si.id = v.target_id
      left join sales_returns sr on v.target_type = 'sales_return' and sr.id = v.target_id
      left join purchase_invoices pi on v.target_type = 'purchase_invoice' and pi.id = v.target_id
      left join expenses ex on v.target_type = 'expense' and ex.id = v.target_id
      left join payroll_entries pe on v.target_type = 'payroll_entry' and pe.id = v.target_id
     where v.company_id = p_company and v.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and v.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'reprints', (select count(*) from audit_log a where a.company_id = p_company and a.action = 'invoice_reprinted'
                  and a.occurred_at >= (p_from::timestamp at time zone 'Africa/Cairo') and a.occurred_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')),
    'no_sales', coalesce((select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by a.occurred_at)
      from audit_log a left join workers w on w.id = a.worker_id left join workers m on m.id = a.approved_by
     where a.company_id = p_company and a.action = 'no_sale' and a.occurred_at >= (p_from::timestamp at time zone 'Africa/Cairo') and a.occurred_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'discounts', (select jsonb_build_object('lines', count(*), 'amount', coalesce(sum(l.line_discount + l.alloc_discount), 0))
      from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
     where i.company_id = p_company and i.status = 'posted' and not i.is_legacy and (l.line_discount + l.alloc_discount) > 0
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')),
    'stock_adjustments', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'at', s.issued_at, 'reason', s.reason_code, 'approved_by', coalesce(m.name, '—')) order by s.issued_at)
      from stock_adjustments s left join workers m on m.id = s.approved_by
     where s.company_id = p_company and s.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and s.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'shift_variances', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'variance', s.variance, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by s.closed_at)
      from shifts s left join workers w on w.id = s.worker_id left join workers m on m.id = s.approved_by
     where s.company_id = p_company and s.status = 'closed' and s.variance <> 0
       and s.closed_at >= (p_from::timestamp at time zone 'Africa/Cairo') and s.closed_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]')
  )) || report_audit_extras_core(p_company, p_from, p_to)
$$;
