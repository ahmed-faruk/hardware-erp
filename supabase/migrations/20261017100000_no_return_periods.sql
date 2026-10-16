-- No return period (owner decision 2026-10-16): a return by invoice, for sales and purchases, is accepted at any age. The quantity caps stay.

create or replace function ingest_sales_return_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ret jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  fixed_lines jsonb := '[]';
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  fixed_smov jsonb := '[]';
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  ret_id uuid := (p_rec ->> 'id')::uuid;
  orig_id uuid := nullif(p_rec ->> 'original_invoice_id', '')::uuid;
  orig sales_invoices;
  ol sales_invoice_lines;
  e jsonb;
  m jsonb;
  seen jsonb := '{}';
  already bigint;
  q bigint;
  final bigint;
  expected bigint;
  base bigint;
  total bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  want_kind text;
  free_seen jsonb := '{}';
  sold_base bigint;
  returned_base bigint;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-RET-%' then
    raise exception 'E_VALIDATION:رقم المرتجع لا يخص الجهاز';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:المرتجع بدون أصناف';
  end if;
  if orig_id is null and worker_can(p_worker.id, 'returnWithoutInvoice') <> 'yes' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة للمدير فقط';
  end if;

  if orig_id is not null then
    select * into orig from sales_invoices where id = orig_id and company_id = p_company;
    if not found or orig.status <> 'posted' then
      raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
    end if;
  end if;

  for e in select * from jsonb_array_elements(lines) loop
    q := (e ->> 'qty')::bigint;
    if q <= 0 then
      raise exception 'E_VALIDATION:كمية غير صالحة';
    end if;
    want_kind := case when e ->> 'condition' = 'damaged' then 'scrap' else 'main' end;
    if (e ->> 'return_id')::uuid is distinct from ret_id then
      raise exception 'E_VALIDATION:سطر لا يخص المرتجع';
    end if;
    if e ->> 'original_line_id' is not null then
      if orig_id is null then
        raise exception 'E_VALIDATION:سطر بدون فاتورة';
      end if;
      select * into ol from sales_invoice_lines where id = (e ->> 'original_line_id')::uuid and invoice_id = orig_id and company_id = p_company;
      if not found then
        raise exception 'E_VALIDATION:سطر غير موجود في الفاتورة';
      end if;
      select coalesce(sum(l.qty), 0) into already from sales_return_lines l join sales_returns h on h.id = l.return_id where l.original_line_id = ol.id and h.status = 'posted';
      already := already + coalesce((seen ->> ol.id::text)::bigint, 0);
      if already + q > ol.qty then
        raise exception 'E_VALIDATION:الكمية المرتجعة أكبر من المباعة';
      end if;
      final := ol.net_amount - ol.alloc_discount;
      expected := ((final * (already + q) * 2 + ol.qty) / (2 * ol.qty)) - ((final * already * 2 + ol.qty) / (2 * ol.qty));
      if (e ->> 'net_amount')::bigint <> expected then
        raise exception 'E_VALIDATION:قيمة المرتجع لا تطابق الفاتورة';
      end if;
      seen := jsonb_set(seen, array[ol.id::text], to_jsonb(coalesce((seen ->> ol.id::text)::bigint, 0) + q));
      if (q * ol.unit_factor) % 1000 <> 0 then
        raise exception 'E_VALIDATION:كمية لا تتحول لوحدة أساسية';
      end if;
      base := q * ol.unit_factor / 1000;
      e := e || jsonb_build_object('unit_cost', ol.unit_cost, 'product_id', ol.product_id);
    else
      if (e ->> 'net_amount')::bigint < 0 or e ->> 'product_id' is null then
        raise exception 'E_VALIDATION:سطر غير صالح';
      end if;
      base := q;
      -- a product with no invoice must have been sold before, and not more than sold - already returned (this document included)
      select coalesce(sum(l.qty * l.unit_factor / 1000), 0) into sold_base
        from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
       where l.product_id = (e ->> 'product_id')::uuid and l.company_id = p_company and i.status = 'posted';
      select coalesce(sum(r.qty * coalesce(o.unit_factor, 1000) / 1000), 0) into returned_base
        from sales_return_lines r join sales_returns h on h.id = r.return_id
        left join sales_invoice_lines o on o.id = r.original_line_id
       where r.product_id = (e ->> 'product_id')::uuid and r.company_id = p_company and h.status = 'posted';
      if sold_base <= 0 then
        raise exception 'E_VALIDATION:الصنف ده ما اتباعش';
      end if;
      returned_base := returned_base + coalesce((free_seen ->> (e ->> 'product_id'))::bigint, 0);
      if returned_base + q > sold_base then
        raise exception 'E_VALIDATION:الكمية المرتجعة أكبر من المباعة';
      end if;
      free_seen := jsonb_set(free_seen, array[e ->> 'product_id'], to_jsonb(coalesce((free_seen ->> (e ->> 'product_id'))::bigint, 0) + q), true);
      e := e || jsonb_build_object('unit_cost', coalesce((select pr.unit_cost from products pr where pr.id = (e ->> 'product_id')::uuid and pr.company_id = p_company), 0));
    end if;
    total := total + (e ->> 'net_amount')::bigint;
    fixed_lines := fixed_lines || jsonb_build_array(e);
    -- one stock movement per line, in base units, to the main (good) or scrap (damaged) warehouse, at the line's cost
    select x into m from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id' limit 1;
    if m is null or (m ->> 'qty')::bigint <> base
       or not exists (select 1 from warehouses w where w.id = (m ->> 'warehouse_id')::uuid and w.company_id = p_company and w.kind = want_kind)
       or (m ->> 'product_id')::uuid is distinct from (e ->> 'product_id')::uuid then
      raise exception 'E_VALIDATION:حركة المخزون لا تطابق المرتجع';
    end if;
    fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', (e ->> 'unit_cost')::bigint));
  end loop;
  if jsonb_array_length(smov) <> jsonb_array_length(lines) then
    raise exception 'E_VALIDATION:حركات مخزون زيادة';
  end if;
  if total <> (ret ->> 'total')::bigint then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;

  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 or e ->> 'document_id' is distinct from ret_id::text or e ->> 'document_type' <> 'sales_return' then
      raise exception 'E_VALIDATION:دفعة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint; else cash_sum := cash_sum + (e ->> 'amount')::bigint; end if;
  end loop;
  if pay_sum <> total then
    raise exception 'E_VALIDATION:الرد لا يطابق الإجمالي';
  end if;
  if credit_sum > 0 and (ret ->> 'customer_id') is null then
    raise exception 'E_VALIDATION:تخفيض المديونية يحتاج عميل';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> -credit_sum then
    raise exception 'E_VALIDATION:حركة العميل لا تطابق الرد';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> -cash_sum then
    raise exception 'E_VALIDATION:حركة الدرج لا تطابق الرد';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from ret_id::text or e ->> 'doc_type' <> 'sales_return' then
      raise exception 'E_VALIDATION:حركة لا تخص المرتجع';
    end if;
  end loop;

  perform ingest_insert('sales_returns', ret, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('sales_return_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;

create or replace function ingest_purchase_return_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  ret jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  ret_id uuid := (p_rec ->> 'id')::uuid;
  orig_id uuid := nullif(p_rec ->> 'original_invoice_id', '')::uuid;
  e jsonb;
  m jsonb;
  ol purchase_invoice_lines;
  pr products;
  q bigint;
  already bigint;
  expected bigint;
  net bigint;
  base bigint;
  cost bigint;
  total bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  seen jsonb := '{}';
  fixed_lines jsonb := '[]';
  fixed_smov jsonb := '[]';
  inv purchase_invoices;
  linked boolean;
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-PRT-%' then
    raise exception 'E_VALIDATION:رقم المرتجع لا يخص الجهاز';
  end if;
  if not exists (select 1 from suppliers s where s.id = (p_rec ->> 'supplier_id')::uuid and s.company_id = p_company) then
    raise exception 'E_VALIDATION:مورد غير موجود';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:مرتجع بدون أصناف';
  end if;
  -- the lines are all linked to purchase lines (of one or several invoices of this supplier) or all without an invoice
  linked := (lines -> 0 ->> 'original_line_id') is not null;
  if (select count(*) from jsonb_array_elements(lines) x where x ->> 'original_line_id' is not null) not in (0, jsonb_array_length(lines)) then
    raise exception 'E_VALIDATION:سطور بفاتورة وبدون فاتورة مع بعض';
  end if;
  if not linked and worker_can(p_worker.id, 'purchaseReturnWithoutInvoice') <> 'yes' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة غير مسموح';
  end if;
  if orig_id is not null and not exists (select 1 from purchase_invoices i where i.id = orig_id and i.company_id = p_company and i.supplier_id = (p_rec ->> 'supplier_id')::uuid and i.status = 'posted') then
    raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
  end if;

  for e in select * from jsonb_array_elements(lines) loop
    q := (e ->> 'qty')::bigint;
    if q <= 0 or (e ->> 'return_id')::uuid is distinct from ret_id then
      raise exception 'E_VALIDATION:سطر غير صالح';
    end if;
    if e ->> 'original_line_id' is not null then
      select * into ol from purchase_invoice_lines where id = (e ->> 'original_line_id')::uuid and company_id = p_company
         and (orig_id is null or invoice_id = orig_id);
      if not found then raise exception 'E_VALIDATION:سطر غير موجود في الفاتورة'; end if;
      select * into inv from purchase_invoices i where i.id = ol.invoice_id and i.company_id = p_company;
      if not found or inv.status <> 'posted' or inv.supplier_id is distinct from (p_rec ->> 'supplier_id')::uuid then
        raise exception 'E_VALIDATION:الفاتورة غير صالحة للمرتجع';
      end if;
      select coalesce(sum(qty), 0) into already from purchase_return_lines where original_line_id = ol.id;
      already := already + coalesce((seen ->> ol.id::text)::bigint, 0);
      if already + q > ol.qty then raise exception 'E_VALIDATION:الكمية المرتجعة أكبر من المشتراة'; end if;
      expected := ((ol.net_amount * (already + q) * 2 + ol.qty) / (2 * ol.qty)) - ((ol.net_amount * already * 2 + ol.qty) / (2 * ol.qty));
      if (e ->> 'net_amount')::bigint <> expected then raise exception 'E_VALIDATION:قيمة المرتجع لا تطابق الفاتورة'; end if;
      seen := jsonb_set(seen, array[ol.id::text], to_jsonb(coalesce((seen ->> ol.id::text)::bigint, 0) + q));
      base := q * ol.unit_factor / 1000;
      if (q * ol.unit_factor) % 1000 <> 0 then raise exception 'E_VALIDATION:كمية لا تتحول لوحدة أساسية'; end if;
      cost := line_cost_per_base(ol.net_amount, ol.qty * ol.unit_factor / 1000);
      e := e || jsonb_build_object('product_id', ol.product_id, 'unit_cost', ol.unit_cost, 'unit_factor', ol.unit_factor);
      net := expected;
    else
      if e ->> 'product_id' is null or (e ->> 'net_amount')::bigint < 0 then raise exception 'E_VALIDATION:سطر غير صالح'; end if;
      select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company;
      if not found then raise exception 'E_VALIDATION:صنف غير موجود'; end if;
      if (e ->> 'unit_factor')::bigint <> 1000 then raise exception 'E_VALIDATION:وحدة غير صالحة'; end if;
      base := q;
      net := (e ->> 'net_amount')::bigint;
      -- the value is the last price from this supplier (or the current cost); only editReturnValue may change it
      if worker_can(p_worker.id, 'editReturnValue') <> 'yes'
         and net <> purchase_return_default_value(p_company, (p_rec ->> 'supplier_id')::uuid, pr.id, q) then
        raise exception 'E_FORBIDDEN:تعديل قيمة المرتجع للمدير';
      end if;
      -- the goods leave stock at the value they are returned for
      cost := case when base > 0 then (net * 1000 * 2 + base) / (2 * base) else 0 end;
    end if;
    total := total + net;
    fixed_lines := fixed_lines || jsonb_build_array(e);
    select * into pr from products where id = (e ->> 'product_id')::uuid;
    if pr.type = 'stock' then
      select x into m from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id' limit 1;
      if m is null or (m ->> 'qty')::bigint <> -base or (m ->> 'product_id')::uuid <> pr.id
         or m ->> 'doc_id' is distinct from ret_id::text or m ->> 'doc_type' <> 'purchase_return'
         or not exists (select 1 from warehouses w where w.id = (m ->> 'warehouse_id')::uuid and w.company_id = p_company and w.kind <> 'scrap') then
        raise exception 'E_VALIDATION:حركة المخزون لا تطابق المرتجع';
      end if;
      fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', cost));
    end if;
  end loop;
  if jsonb_array_length(smov) <> jsonb_array_length(fixed_smov) then
    raise exception 'E_VALIDATION:حركات مخزون زيادة';
  end if;
  if (ret ->> 'total')::bigint <> total then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;

  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 or e ->> 'document_id' is distinct from ret_id::text or e ->> 'document_type' <> 'purchase_return' then
      raise exception 'E_VALIDATION:دفعة غير صالحة';
    end if;
    pay_sum := pay_sum + (e ->> 'amount')::bigint;
    if e ->> 'method' = 'credit' then credit_sum := credit_sum + (e ->> 'amount')::bigint;
    elsif e ->> 'method' = 'cash' then
      cash_sum := cash_sum + (e ->> 'amount')::bigint;
      if not exists (select 1 from cash_accounts a where a.id = (e ->> 'cash_account_id')::uuid and a.company_id = p_company) then
        raise exception 'E_VALIDATION:حساب نقدية غير صالح';
      end if;
    end if;
  end loop;
  if pay_sum <> total then raise exception 'E_VALIDATION:الرد لا يطابق الإجمالي'; end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> credit_sum
     or coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> cash_sum then
    raise exception 'E_VALIDATION:حركات الحساب لا تطابق الرد';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from ret_id::text or e ->> 'doc_type' <> 'purchase_return' then
      raise exception 'E_VALIDATION:حركة لا تخص المرتجع';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(pled) loop
    if (e ->> 'party_type') <> 'supplier' or (e ->> 'party_id')::uuid is distinct from (p_rec ->> 'supplier_id')::uuid then
      raise exception 'E_VALIDATION:حركة المورد غير صالحة';
    end if;
  end loop;

  perform ingest_insert('purchase_returns', ret, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('purchase_return_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;
