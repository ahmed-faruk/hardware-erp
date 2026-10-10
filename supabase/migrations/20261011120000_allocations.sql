-- FIN-06 / PUR-06: a collection or a supplier payment may name the credit invoices it settles.
alter table customer_receipts add column allocations jsonb;
alter table supplier_payments add column allocations jsonb;

-- allocations = null or [{invoice_id, amount}]: positive amounts adding up to at most the document's amount, only to posted invoices of the same
-- party, and never more than the invoice's credit part minus what other documents already settled on it.
create or replace function check_allocations(p_kind text, p_company uuid, p_party uuid, p_amount bigint, p_alloc jsonb, p_self uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e jsonb;
  inv uuid;
  credit bigint;
  already bigint;
  total bigint := 0;
  mine bigint;
begin
  if p_alloc is null or jsonb_typeof(p_alloc) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_alloc) <> 'array' then
    raise exception 'E_VALIDATION:تخصيص غير صالح';
  end if;
  for e in select * from jsonb_array_elements(p_alloc) loop
    if (e ->> 'amount')::bigint is null or (e ->> 'amount')::bigint <= 0 then
      raise exception 'E_VALIDATION:مبلغ التخصيص غير صالح';
    end if;
    total := total + (e ->> 'amount')::bigint;
  end loop;
  if total > p_amount then
    raise exception 'E_VALIDATION:التخصيص أكبر من المبلغ';
  end if;
  for inv in select distinct (x ->> 'invoice_id')::uuid from jsonb_array_elements(p_alloc) x loop
    if p_kind = 'customer' then
      if not exists (select 1 from sales_invoices i where i.id = inv and i.company_id = p_company and i.customer_id = p_party and i.status = 'posted') then
        raise exception 'E_VALIDATION:فاتورة غير صالحة للتخصيص';
      end if;
      select coalesce(sum(amount), 0) into credit from payments where document_type = 'sales_invoice' and document_id = inv and method = 'credit';
      select coalesce(sum((x ->> 'amount')::bigint), 0) into already
        from customer_receipts r, jsonb_array_elements(coalesce(r.allocations, '[]')) x
       where r.company_id = p_company and r.id <> p_self and (x ->> 'invoice_id')::uuid = inv;
    else
      if not exists (select 1 from purchase_invoices i where i.id = inv and i.company_id = p_company and i.supplier_id = p_party and i.status = 'posted') then
        raise exception 'E_VALIDATION:فاتورة غير صالحة للتخصيص';
      end if;
      select coalesce(sum(amount), 0) into credit from payments where document_type = 'purchase_invoice' and document_id = inv and method = 'credit';
      select coalesce(sum((x ->> 'amount')::bigint), 0) into already
        from supplier_payments r, jsonb_array_elements(coalesce(r.allocations, '[]')) x
       where r.company_id = p_company and r.id <> p_self and (x ->> 'invoice_id')::uuid = inv;
    end if;
    select coalesce(sum((x ->> 'amount')::bigint), 0) into mine from jsonb_array_elements(p_alloc) x where (x ->> 'invoice_id')::uuid = inv;
    if mine > credit - already then
      raise exception 'E_VALIDATION:التخصيص أكبر من المتبقي على الفاتورة';
    end if;
  end loop;
end $$;
revoke all on function check_allocations(text, uuid, uuid, bigint, jsonb, uuid) from public, anon, authenticated;

create or replace function ingest_customer_receipt_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rc jsonb := p_rec - 'party_ledger' - 'cash_movements';
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  rc_id uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-RCV-%' then
    raise exception 'E_VALIDATION:رقم السند لا يخص الجهاز';
  end if;
  if amount <= 0 or not exists (select 1 from customers c where c.id = (p_rec ->> 'customer_id')::uuid and c.company_id = p_company) then
    raise exception 'E_VALIDATION:تحصيل غير صالح';
  end if;
  if jsonb_array_length(pled) <> 1 or (pled -> 0 ->> 'amount')::bigint <> -amount or (pled -> 0 ->> 'party_id')::uuid <> (p_rec ->> 'customer_id')::uuid then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق التحصيل';
  end if;
  if p_rec ->> 'method' = 'cash' then
    if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> amount
       or not exists (select 1 from cash_accounts a where a.id = (cmov -> 0 ->> 'cash_account_id')::uuid and a.company_id = p_company) then
      raise exception 'E_VALIDATION:حركة الدرج لا تطابق التحصيل';
    end if;
  elsif jsonb_array_length(cmov) <> 0 then
    raise exception 'E_VALIDATION:التحصيل غير النقدي لا يدخل الدرج';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from rc_id::text or e ->> 'doc_type' <> 'customer_receipt' then
      raise exception 'E_VALIDATION:حركة لا تخص التحصيل';
    end if;
  end loop;
  perform check_allocations('customer', p_company, (p_rec ->> 'customer_id')::uuid, amount, p_rec -> 'allocations', rc_id);
  perform ingest_insert('customer_receipts', rc, p_company, p_device);
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;

create or replace function ingest_supplier_payment_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pay jsonb := p_rec - 'party_ledger' - 'cash_movements';
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  pid uuid := (p_rec ->> 'id')::uuid;
  amount bigint := (p_rec ->> 'amount')::bigint;
  e jsonb;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-PAY-%' then
    raise exception 'E_VALIDATION:رقم السند لا يخص الجهاز';
  end if;
  if amount <= 0 or not exists (select 1 from suppliers s where s.id = (p_rec ->> 'supplier_id')::uuid and s.company_id = p_company) then
    raise exception 'E_VALIDATION:سداد غير صالح';
  end if;
  if jsonb_array_length(pled) <> 1 or (pled -> 0 ->> 'amount')::bigint <> amount or (pled -> 0 ->> 'party_id')::uuid <> (p_rec ->> 'supplier_id')::uuid or (pled -> 0 ->> 'party_type') <> 'supplier' then
    raise exception 'E_VALIDATION:حركة المورد لا تطابق السداد';
  end if;
  if p_rec ->> 'method' = 'cash' then
    if jsonb_array_length(cmov) <> 1 or (cmov -> 0 ->> 'amount')::bigint <> -amount
       or not exists (select 1 from cash_accounts a where a.id = (cmov -> 0 ->> 'cash_account_id')::uuid and a.company_id = p_company) then
      raise exception 'E_VALIDATION:حركة النقدية لا تطابق السداد';
    end if;
  elsif jsonb_array_length(cmov) <> 0 then
    raise exception 'E_VALIDATION:السداد غير النقدي لا يمس النقدية';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from pid::text or e ->> 'doc_type' <> 'supplier_payment' then
      raise exception 'E_VALIDATION:حركة لا تخص السداد';
    end if;
  end loop;
  perform check_allocations('supplier', p_company, (p_rec ->> 'supplier_id')::uuid, amount, p_rec -> 'allocations', pid);
  perform ingest_insert('supplier_payments', pay, p_company, p_device);
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;
