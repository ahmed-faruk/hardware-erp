-- Item movement history: every sale, return, purchase, adjustment and the opening balance of one product, newest first, with the balance after each row.
-- Imported OpenSourcePOS history has lines but no stock movements: those rows are listed too (legacy = true) and their balance
-- continues backwards from the opening quantity. Everything after the import is read from stock_movements and balances run backwards from today's.

create or replace function report_product_history_core(p_company uuid, p_product uuid, p_from date, p_to date, p_offset int)
returns jsonb
language sql stable security definer set search_path = public as $$
  with mv as (
    select m.id, m.occurred_at at, m.doc_type, m.doc_id, m.qty delta, false legacy
      from stock_movements m
     where m.company_id = p_company and m.product_id = p_product and m.deleted_at is null
  ), leg as (
    select l.id, i.issued_at at, 'sales_invoice'::text doc_type, i.id doc_id, -((l.qty * l.unit_factor) / 1000) delta, true legacy
      from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
     where l.company_id = p_company and l.product_id = p_product and l.is_legacy and l.deleted_at is null and i.status = 'posted'
    union all
    select l.id, r.issued_at, 'sales_return', r.id, l.qty, true
      from sales_return_lines l join sales_returns r on r.id = l.return_id
     where l.company_id = p_company and l.product_id = p_product and l.is_legacy and l.deleted_at is null and r.status = 'posted'
    union all
    select l.id, i.issued_at, 'purchase_invoice', i.id, (l.qty * l.unit_factor) / 1000, true
      from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
     where l.company_id = p_company and l.product_id = p_product and l.is_legacy and l.deleted_at is null and i.status = 'posted'
    union all
    select l.id, r.issued_at, 'purchase_return', r.id, -((l.qty * l.unit_factor) / 1000), true
      from purchase_return_lines l join purchase_returns r on r.id = l.return_id
     where l.company_id = p_company and l.product_id = p_product and l.is_legacy and l.deleted_at is null and r.status = 'posted'
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
           coalesce(si.number, sr.number, pi.number, pr.number, sa.number, vd.number, op.number) number,
           coalesce(c1.name, c2.name, s1.name, s2.name) party
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
    'rows', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'doc_type', doc_type, 'number', number, 'party', party,
                'in_qty', greatest(delta, 0), 'out_qty', greatest(-delta, 0), 'balance', balance, 'legacy', legacy)
                order by at desc, id desc)
       from (select * from shown order by at desc, id desc offset greatest(p_offset, 0) limit 500) x), '[]')
  )
$$;

create or replace function report_product_history(p_product uuid, p_from date, p_to date, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'E_VALIDATION:فترة غير صالحة';
  end if;
  if not exists (select 1 from products where id = p_product and company_id = current_company()) then
    raise exception 'E_VALIDATION:صنف غير موجود';
  end if;
  return jsonb_build_object('ok', true, 'data', report_product_history_core(current_company(), p_product, p_from, p_to, p_offset), 'generated_at', now());
end $$;

revoke all on function report_product_history_core(uuid, uuid, date, date, int) from public, anon, authenticated;
revoke all on function report_product_history(uuid, date, date, int) from public, anon;
grant execute on function report_product_history(uuid, date, date, int) to authenticated;
