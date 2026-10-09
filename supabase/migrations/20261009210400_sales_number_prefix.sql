-- Invoice numbers must carry the pushing device's prefix (numbers are unique per device, docs/DATABASE.md §3)
create or replace function ingest_sales_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  e jsonb;
  inv_id uuid := (p_rec ->> 'id')::uuid;
  line_sum bigint := 0;
  alloc_sum bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  base_qty bigint;
  moved bigint;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-INV-%' then
    raise exception 'E_VALIDATION:رقم الفاتورة لا يخص الجهاز';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:الفاتورة بدون أصناف';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    if (e ->> 'qty')::bigint <= 0 or (e ->> 'net_amount')::bigint < 0 or (e ->> 'alloc_discount')::bigint < 0
       or (e ->> 'unit_price')::bigint < 0 then
      raise exception 'E_VALIDATION:قيمة غير صالحة';
    end if;
    line_sum := line_sum + (e ->> 'net_amount')::bigint - (e ->> 'alloc_discount')::bigint;
    alloc_sum := alloc_sum + (e ->> 'alloc_discount')::bigint;
    if (e ->> 'invoice_id')::uuid is distinct from inv_id then
      raise exception 'E_VALIDATION:صنف لا يخص الفاتورة';
    end if;
  end loop;
  if line_sum + (inv ->> 'tax_total')::bigint <> (inv ->> 'total')::bigint then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;
  if alloc_sum <> (inv ->> 'invoice_discount')::bigint then
    raise exception 'E_VALIDATION:الخصم لا يطابق الأصناف';
  end if;
  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 then
      raise exception 'E_VALIDATION:قيمة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint; end if;
    if e ->> 'method' = 'cash' then cash_sum := cash_sum + (e ->> 'amount')::bigint; end if;
    if e ->> 'document_id' is distinct from inv_id::text or e ->> 'document_type' <> 'sales_invoice' then
      raise exception 'E_VALIDATION:دفعة لا تخص الفاتورة';
    end if;
  end loop;
  if pay_sum <> (inv ->> 'total')::bigint then
    raise exception 'E_VALIDATION:المدفوع لا يطابق الإجمالي';
  end if;
  if credit_sum > 0 and (inv ->> 'customer_id') is null then
    raise exception 'E_VALIDATION:الآجل يحتاج عميل';
  end if;
  -- ledger rows must match the document (no movement without a document, no document without movements)
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> credit_sum then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق الآجل';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> cash_sum then
    raise exception 'E_VALIDATION:حركة الدرج لا تطابق النقدي';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    if e ->> 'product_id' is not null and exists (select 1 from products p where p.id = (e ->> 'product_id')::uuid and p.type = 'stock') then
      base_qty := ((e ->> 'qty')::bigint * (e ->> 'unit_factor')::bigint) / 1000;
      select coalesce(sum(- (x ->> 'qty')::bigint), 0) into moved
        from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id';
      if moved <> base_qty then
        raise exception 'E_VALIDATION:حركة المخزون لا تطابق الصنف';
      end if;
    end if;
  end loop;
  for e in select * from jsonb_array_elements(smov || pled || cmov) loop
    if e ->> 'doc_id' is distinct from inv_id::text then
      raise exception 'E_VALIDATION:حركة لا تخص الفاتورة';
    end if;
  end loop;

  perform ingest_insert('sales_invoices', inv, p_company, p_device);
  for e in select * from jsonb_array_elements(lines) loop perform ingest_insert('sales_invoice_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;
