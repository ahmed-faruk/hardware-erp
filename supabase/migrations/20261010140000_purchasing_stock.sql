-- Phase 7 PR B: purchases, purchase returns, supplier payments and stock adjustments as atomic bundles.

alter table purchase_return_lines add column original_line_id uuid references purchase_invoice_lines (id);

update sync_tables set push_action = 'receivePurchase' where table_name in ('purchase_invoices', 'purchase_returns');
update sync_tables set push_action = 'supplierPayment' where table_name = 'supplier_payments';
update sync_tables set push_action = 'stockAdjustment' where table_name = 'stock_adjustments';

-- same maths as movingAverage() in src/domain/costing.ts: half-up on the weighted average, base units
create or replace function moving_average(p_old_qty bigint, p_old_avg bigint, p_in_qty bigint, p_in_cost bigint) returns bigint
language sql immutable as $$
  select case when p_old_qty <= 0 then p_in_cost
              else ((p_old_qty * p_old_avg + p_in_qty * p_in_cost) * 2 + (p_old_qty + p_in_qty)) / (2 * (p_old_qty + p_in_qty)) end
$$;

-- cost per base unit of a line: net * 1000 / base qty (milli), half-up
create or replace function line_cost_per_base(p_net bigint, p_base_qty bigint) returns bigint
language sql immutable as $$ select (p_net * 1000 * 2 + p_base_qty) / (2 * p_base_qty) $$;

-- PUR-01..02, PUR-06: goods received; the server fixes each line's cost and the product's moving average
create or replace function ingest_purchase_bundle(p_rec jsonb, p_company uuid, p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv jsonb := p_rec - 'lines' - 'payments' - 'stock_movements' - 'party_ledger' - 'cash_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  pays jsonb := coalesce(p_rec -> 'payments', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  pled jsonb := coalesce(p_rec -> 'party_ledger', '[]');
  cmov jsonb := coalesce(p_rec -> 'cash_movements', '[]');
  inv_id uuid := (p_rec ->> 'id')::uuid;
  e jsonb;
  m jsonb;
  pr products;
  gross bigint;
  disc bigint;
  net bigint;
  base bigint;
  cost bigint;
  oldq bigint;
  subtotal bigint := 0;
  disc_sum bigint := 0;
  total bigint := 0;
  pay_sum bigint := 0;
  credit_sum bigint := 0;
  cash_sum bigint := 0;
  fixed_smov jsonb := '[]';
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-PUR-%' then
    raise exception 'E_VALIDATION:رقم الفاتورة لا يخص الجهاز';
  end if;
  if not exists (select 1 from suppliers s where s.id = (p_rec ->> 'supplier_id')::uuid and s.company_id = p_company) then
    raise exception 'E_VALIDATION:مورد غير موجود';
  end if;
  if jsonb_array_length(lines) = 0 then
    raise exception 'E_VALIDATION:فاتورة بدون أصناف';
  end if;
  if not exists (select 1 from warehouses w where w.id = (p_rec ->> 'warehouse_id')::uuid and w.company_id = p_company and w.kind <> 'scrap') then
    raise exception 'E_VALIDATION:مخزن غير صالح';
  end if;

  -- check every line first (nothing is written yet)
  for e in select * from jsonb_array_elements(lines) loop
    if (e ->> 'invoice_id')::uuid is distinct from inv_id then
      raise exception 'E_VALIDATION:سطر لا يخص الفاتورة';
    end if;
    select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company;
    if not found then
      raise exception 'E_VALIDATION:صنف غير موجود';
    end if;
    if (e ->> 'qty')::bigint <= 0 or (e ->> 'unit_cost')::bigint < 0 or (e ->> 'unit_factor')::bigint <= 0 then
      raise exception 'E_VALIDATION:كمية أو تكلفة غير صالحة';
    end if;
    gross := ((e ->> 'qty')::bigint * (e ->> 'unit_cost')::bigint + 500) / 1000;
    disc := coalesce((e ->> 'discount')::bigint, 0);
    if disc < 0 or disc > gross or (e ->> 'net_amount')::bigint <> gross - disc then
      raise exception 'E_VALIDATION:قيمة السطر لا تطابق الكمية والتكلفة';
    end if;
    if ((e ->> 'qty')::bigint * (e ->> 'unit_factor')::bigint) % 1000 <> 0 then
      raise exception 'E_VALIDATION:كمية لا تتحول لوحدة أساسية';
    end if;
    subtotal := subtotal + gross;
    disc_sum := disc_sum + disc;
    total := total + gross - disc;
  end loop;
  if (inv ->> 'subtotal')::bigint <> subtotal or coalesce((inv ->> 'discount')::bigint, 0) <> disc_sum or (inv ->> 'total')::bigint <> total then
    raise exception 'E_VALIDATION:الإجمالي لا يطابق الأصناف';
  end if;

  for e in select * from jsonb_array_elements(pays) loop
    if (e ->> 'amount')::bigint <= 0 or e ->> 'document_id' is distinct from inv_id::text or e ->> 'document_type' <> 'purchase_invoice' then
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
  if pay_sum <> total then
    raise exception 'E_VALIDATION:المدفوع لا يطابق الإجمالي';
  end if;
  if coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(pled) x), 0) <> -credit_sum
     or coalesce((select sum((x ->> 'amount')::bigint) from jsonb_array_elements(cmov) x), 0) <> -cash_sum then
    raise exception 'E_VALIDATION:حركات الحساب لا تطابق الدفع';
  end if;
  for e in select * from jsonb_array_elements(pled || cmov) loop
    if e ->> 'doc_id' is distinct from inv_id::text or e ->> 'doc_type' <> 'purchase_invoice' then
      raise exception 'E_VALIDATION:حركة لا تخص الفاتورة';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(pled) loop
    if (e ->> 'party_type') <> 'supplier' or (e ->> 'party_id')::uuid is distinct from (p_rec ->> 'supplier_id')::uuid then
      raise exception 'E_VALIDATION:حركة المورد غير صالحة';
    end if;
  end loop;

  perform ingest_insert('purchase_invoices', inv, p_company, p_device);
  for e in select * from jsonb_array_elements(lines) loop
    perform ingest_insert('purchase_invoice_lines', e, p_company, p_device);
    select * into pr from products where id = (e ->> 'product_id')::uuid;
    if pr.type = 'stock' then
      base := (e ->> 'qty')::bigint * (e ->> 'unit_factor')::bigint / 1000;
      cost := line_cost_per_base((e ->> 'net_amount')::bigint, base);
      select coalesce(sum(qty), 0) into oldq from stock_movements where product_id = pr.id and company_id = p_company;
      update products set unit_cost = moving_average(oldq, coalesce(pr.unit_cost, 0), base, cost), updated_at = now(), version = version + 1 where id = pr.id;
      select x into m from jsonb_array_elements(smov) x where x ->> 'line_id' = e ->> 'id' limit 1;
      if m is null or (m ->> 'qty')::bigint <> base or (m ->> 'product_id')::uuid <> pr.id
         or (m ->> 'warehouse_id')::uuid is distinct from (p_rec ->> 'warehouse_id')::uuid
         or m ->> 'doc_id' is distinct from inv_id::text or m ->> 'doc_type' <> 'purchase_invoice' then
        raise exception 'E_VALIDATION:حركة المخزون لا تطابق الفاتورة';
      end if;
      perform ingest_insert('stock_movements', m || jsonb_build_object('unit_cost', cost), p_company, p_device);
    end if;
  end loop;
  if jsonb_array_length(smov) <> (select count(*) from jsonb_array_elements(lines) l join products p on p.id = (l ->> 'product_id')::uuid where p.type = 'stock') then
    raise exception 'E_VALIDATION:حركات مخزون زيادة';
  end if;
  for e in select * from jsonb_array_elements(pays) loop perform ingest_insert('payments', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;

-- a purchase return: goods go back to the supplier at the cost they came in, the refund lowers what we owe or comes back as cash
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
  if orig_id is null and p_worker.role <> 'manager' then
    raise exception 'E_FORBIDDEN:المرتجع بدون فاتورة للمدير فقط';
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
      if orig_id is null then raise exception 'E_VALIDATION:سطر بدون فاتورة'; end if;
      select * into ol from purchase_invoice_lines where id = (e ->> 'original_line_id')::uuid and invoice_id = orig_id and company_id = p_company;
      if not found then raise exception 'E_VALIDATION:سطر غير موجود في الفاتورة'; end if;
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
      cost := coalesce(pr.unit_cost, 0);
      net := (e ->> 'net_amount')::bigint;
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

-- we pay a supplier: manager only (checked by role_can in ingest_row)
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
  perform ingest_insert('supplier_payments', pay, p_company, p_device);
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
end $$;

-- INV-06 / INV-10: a stock correction with a reason; above the approval value a manager must approve
create or replace function ingest_stock_adjustment_bundle(p_rec jsonb, p_company uuid, p_device uuid, p_worker workers) returns void
language plpgsql security definer set search_path = public as $$
declare
  adj jsonb := p_rec - 'lines' - 'stock_movements';
  lines jsonb := coalesce(p_rec -> 'lines', '[]');
  smov jsonb := coalesce(p_rec -> 'stock_movements', '[]');
  adj_id uuid := (p_rec ->> 'id')::uuid;
  reason text := p_rec ->> 'reason_code';
  wh uuid := (p_rec ->> 'warehouse_id')::uuid;
  e jsonb;
  m jsonb;
  pr products;
  delta bigint;
  adj_value bigint := 0;
  threshold bigint;
  fixed_lines jsonb := '[]';
  fixed_smov jsonb := '[]';
begin
  if (p_rec ->> 'number') not like (select prefix from devices where id = p_device) || '-ADJ-%' then
    raise exception 'E_VALIDATION:رقم التسوية لا يخص الجهاز';
  end if;
  if reason not in ('count', 'damaged', 'lost', 'found', 'other') then
    raise exception 'E_VALIDATION:سبب التسوية مطلوب';
  end if;
  if jsonb_array_length(lines) = 0 or jsonb_array_length(lines) <> jsonb_array_length(smov) then
    raise exception 'E_VALIDATION:تسوية غير مكتملة';
  end if;
  if not exists (select 1 from warehouses w where w.id = wh and w.company_id = p_company) then
    raise exception 'E_VALIDATION:مخزن غير صالح';
  end if;
  for e in select * from jsonb_array_elements(lines) loop
    delta := (e ->> 'qty_delta')::bigint;
    select * into pr from products where id = (e ->> 'product_id')::uuid and company_id = p_company and type = 'stock';
    if not found or delta = 0 or (e ->> 'adjustment_id')::uuid is distinct from adj_id then
      raise exception 'E_VALIDATION:سطر تسوية غير صالح';
    end if;
    if (reason in ('damaged', 'lost') and delta > 0) or (reason = 'found' and delta < 0) then
      raise exception 'E_VALIDATION:الكمية لا تناسب السبب';
    end if;
    select x into m from jsonb_array_elements(smov) x where x ->> 'product_id' = pr.id::text and (x ->> 'qty')::bigint = delta and x ->> 'doc_id' = adj_id::text and x ->> 'doc_type' = 'stock_adjustment' and (x ->> 'warehouse_id')::uuid = wh limit 1;
    if m is null then
      raise exception 'E_VALIDATION:حركة المخزون لا تطابق التسوية';
    end if;
    adj_value := adj_value + abs(delta) * coalesce(pr.unit_cost, 0) / 1000;
    fixed_lines := fixed_lines || jsonb_build_array(e || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
    fixed_smov := fixed_smov || jsonb_build_array(m || jsonb_build_object('unit_cost', coalesce(pr.unit_cost, 0)));
  end loop;
  select coalesce((select (value #>> '{}')::bigint from settings where company_id = p_company and key = 'stock.approvalAbove' and deleted_at is null), 50000) into threshold;
  if p_worker.role <> 'manager' and adj_value > threshold
     and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and a.role = 'manager' and a.company_id = p_company and a.active) then
    raise exception 'E_FORBIDDEN:التسوية دي محتاجة موافقة المدير';
  end if;
  perform ingest_insert('stock_adjustments', adj, p_company, p_device);
  for e in select * from jsonb_array_elements(fixed_lines) loop perform ingest_insert('stock_adjustment_lines', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(fixed_smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
end $$;

create or replace function ingest_row(p_device devices, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  st sync_tables;
  rec jsonb := p_row -> 'record';
  w workers;
  actor uuid := coalesce((p_row ->> 'worker_id')::uuid, (rec ->> 'created_by')::uuid);
begin
  select * into st from sync_tables where table_name = p_row ->> 'table' and push_action is not null;
  if not found or p_row ->> 'op' is distinct from 'upsert' or jsonb_typeof(rec) <> 'object' or rec ->> 'id' is null then
    raise exception 'E_VALIDATION:جدول غير مسموح';
  end if;
  select * into w from workers
   where id = actor and company_id = p_device.company_id and active and deleted_at is null;
  if not found then
    raise exception 'E_FORBIDDEN:عامل غير معروف';
  end if;
  if w.role = 'manager' and p_device.max_role <> 'manager' then
    raise exception 'E_FORBIDDEN:الجهاز لا يسمح بهذا الدور';
  end if;
  if st.push_action <> 'any' and role_can(w.role, st.push_action) = 'no' then
    raise exception 'E_FORBIDDEN:غير مسموح';
  end if;
  if st.table_name = 'customers' and w.role <> 'manager' then
    if exists (select 1 from customers where id = (rec ->> 'id')::uuid)
       or coalesce((rec ->> 'credit_limit')::bigint, 0) <> 0
       or coalesce((rec ->> 'default_discount_bp')::int, 0) <> 0 then
      raise exception 'E_FORBIDDEN:غير مسموح';
    end if;
  end if;
  if st.table_name = 'sales_returns' then
    perform ingest_sales_return_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'voids' then
    perform ingest_void_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'customer_receipts' then
    perform ingest_customer_receipt_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'purchase_invoices' then
    perform ingest_purchase_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'purchase_returns' then
    perform ingest_purchase_return_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'supplier_payments' then
    perform ingest_supplier_payment_bundle(rec, p_device.company_id, p_device.id);
  elsif st.table_name = 'stock_adjustments' then
    perform ingest_stock_adjustment_bundle(rec, p_device.company_id, p_device.id, w);
  elsif st.table_name = 'sales_invoices' then
    perform ingest_sales_bundle(rec, p_device.company_id, p_device.id);
  elsif st.kind = 'master' then
    perform ingest_master(st.table_name, rec, p_row -> 'changed_fields', (p_row ->> 'base_version')::int,
                          p_device.company_id, p_device.id);
  else
    perform ingest_insert(st.table_name, rec, p_device.company_id, p_device.id);
  end if;
end $$;
