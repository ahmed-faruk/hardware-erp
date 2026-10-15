-- Voiding a sales return: a void document can now target a sales_return (permission voidReturn, manager only).
-- It reverses the return's stock, customer and cash rows exactly; the return becomes voided and the invoice can be returned again.
-- Everything that adds up returns now counts posted returns only.

update sync_tables set push_action = 'any' where table_name = 'voids'; -- the bundle checks void or voidReturn by target type

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
  ret sales_returns;
  e jsonb;
begin
  if p_rec ->> 'target_type' not in ('sales_invoice', 'sales_return') then
    raise exception 'E_VALIDATION:مستند إلغاء غير صالح';
  end if;
  if worker_can(p_worker.id, case when p_rec ->> 'target_type' = 'sales_return' then 'voidReturn' else 'void' end) <> 'yes' then
    raise exception 'E_FORBIDDEN:الإلغاء للمدير فقط';
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
  else
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
  end if;
  -- the reversing rows must be exactly the negation of what the invoice wrote: same keys, opposite totals, same row counts
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
     or exists (
       select 1 from (select cash_account_id, sum(amount) q from cash_movements where doc_id = target group by 1) o
       full join (select (x ->> 'cash_account_id')::uuid cash_account_id, sum((x ->> 'amount')::bigint) q from jsonb_array_elements(cmov) x group by 1) r using (cash_account_id)
       where coalesce(o.q, 0) + coalesce(r.q, 0) <> 0) then
    raise exception 'E_VALIDATION:الحركات العكسية لا تطابق الفاتورة';
  end if;
  for e in select * from jsonb_array_elements(smov || pled || cmov) loop
    if e ->> 'doc_id' is distinct from void_id::text or e ->> 'doc_type' <> 'void' then
      raise exception 'E_VALIDATION:حركة لا تخص الإلغاء';
    end if;
  end loop;
  perform ingest_insert('voids', vd, p_company, p_device);
  for e in select * from jsonb_array_elements(smov) loop perform ingest_insert('stock_movements', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(pled) loop perform ingest_insert('party_ledger', e, p_company, p_device); end loop;
  for e in select * from jsonb_array_elements(cmov) loop perform ingest_insert('cash_movements', e, p_company, p_device); end loop;
  if p_rec ->> 'target_type' = 'sales_invoice' then
    update sales_invoices set status = 'voided', voided_by = void_id where id = target;
  else
    update sales_returns set status = 'voided', voided_by = void_id where id = target;
  end if;
end $$;

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
  days int;
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
    select coalesce((select (value #>> '{}')::int from settings where company_id = p_company and key = 'return.periodDays' and deleted_at is null), 30) into days;
    if worker_can(p_worker.id, 'returnAfterPeriod') <> 'yes'
       and (now() at time zone 'Africa/Cairo')::date - (orig.issued_at at time zone 'Africa/Cairo')::date > days
       and not exists (select 1 from workers a where a.id = nullif(p_rec ->> 'approved_by', '')::uuid and worker_can(a.id, 'returnAfterPeriod') = 'yes' and a.company_id = p_company and a.active) then
      raise exception 'E_FORBIDDEN:المرتجع بعد المهلة يحتاج موافقة المدير';
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

create or replace function report_product_history_core(p_company uuid, p_product uuid, p_from date, p_to date, p_offset int)
returns jsonb
language sql stable security definer set search_path = public as $$
  with prod as (
    select legacy_item_id from products where id = p_product and company_id = p_company
  ), mv as (
    select m.id::text id, m.occurred_at at, m.doc_type, m.doc_id, m.qty delta, false legacy, null::text lnumber, null::text lparty
      from stock_movements m
     where m.company_id = p_company and m.product_id = p_product and m.deleted_at is null
  ), leg as (
    select 'S' || l.sale_id || ':' || l.line_no, (s.day::timestamp at time zone 'Africa/Cairo'),
           case when s.kind = 0 then 'sales_invoice' else 'sales_return' end, null::uuid,
           case when s.kind = 0 then -l.qty::bigint else l.qty::bigint end, true,
           'LG-' || case when s.kind = 0 then 'INV' else 'RET' end || '-' || lpad(s.id::text, 6, '0'), c.name
      from legacy_sale_lines l join legacy_sales s on s.id = l.sale_id left join customers c on c.company_id = s.company_id and c.legacy_person_id = s.customer_id
     where s.company_id = p_company and l.product_id = (select legacy_item_id from prod)
    union all
    select 'P' || l.purchase_id || ':' || l.line_no, (p.day::timestamp at time zone 'Africa/Cairo'),
           case when p.kind = 0 then 'purchase_invoice' else 'purchase_return' end, null::uuid,
           case when p.kind = 0 then l.qty::bigint else -l.qty::bigint end, true,
           'LG-' || case when p.kind = 0 then 'PUR' else 'PRT' end || '-' || lpad(p.id::text, 6, '0'), sp.name
      from legacy_purchase_lines l join legacy_purchases p on p.id = l.purchase_id left join suppliers sp on sp.company_id = p.company_id and sp.legacy_person_id = p.supplier_id
     where p.company_id = p_company and l.product_id = (select legacy_item_id from prod)
  ), ev as (
    select * from mv union all select * from leg
  ), tot as (
    select coalesce(sum(delta), 0)::bigint now_balance,
           coalesce(sum(delta) filter (where doc_type <> 'opening'), 0)::bigint moves
      from mv
  ), ranked as (
    select ev.*,
           case when ev.legacy
                then (select now_balance - moves from tot)
                     - coalesce(sum(ev.delta) filter (where ev.legacy) over w, 0)
                else (select now_balance from tot)
                     - coalesce(sum(ev.delta) filter (where not ev.legacy) over w, 0)
           end balance
      from ev
    window w as (order by ev.at desc, ev.id desc rows between unbounded preceding and 1 preceding)
  ), shown as (
    select r.*,
           coalesce(r.lnumber, si.number, sr.number, pi.number, pr.number, sa.number, vd.number, op.number) number,
           coalesce(r.lparty, c1.name, c2.name, s1.name, s2.name) party,
           vd.target_type void_target
      from ranked r
      left join sales_invoices si on r.doc_type = 'sales_invoice' and si.id = r.doc_id
      left join sales_returns sr on r.doc_type = 'sales_return' and sr.id = r.doc_id
      left join purchase_invoices pi on r.doc_type = 'purchase_invoice' and pi.id = r.doc_id
      left join purchase_returns pr on r.doc_type = 'purchase_return' and pr.id = r.doc_id
      left join stock_adjustments sa on r.doc_type = 'stock_adjustment' and sa.id = r.doc_id
      left join voids vd on r.doc_type = 'void' and vd.id = r.doc_id
      left join openings op on r.doc_type = 'opening' and op.id = r.doc_id
      left join customers c1 on c1.id = si.customer_id
      left join customers c2 on c2.id = sr.customer_id
      left join suppliers s1 on s1.id = pi.supplier_id
      left join suppliers s2 on s2.id = pr.supplier_id
     where (r.at at time zone 'Africa/Cairo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'product', (select jsonb_build_object('id', p.id, 'name', p.name) from products p where p.id = p_product),
    'balance_now', (select now_balance from tot),
    'count', (select count(*) from shown),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'doc_type', case when doc_type = 'void' and void_target = 'sales_return' then 'void_return' else doc_type end, 'number', number, 'party', party,
                'in_qty', greatest(delta, 0), 'out_qty', greatest(-delta, 0), 'balance', balance, 'legacy', legacy)
                order by at desc, id desc)
       from (select * from shown order by at desc, id desc offset greatest(p_offset, 0) limit 500) x), '[]')
  )
$$;
