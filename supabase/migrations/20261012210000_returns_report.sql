-- Returns report: sales returns and purchase returns of a period, device documents and the imported OpenSourcePOS history together.
-- Sargable ranges like report_speed (Cairo days); voided documents are left out.

create function report_returns_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with lo as (select (p_from::timestamp at time zone 'Africa/Cairo') t),
       hi as (select ((p_to + 1)::timestamp at time zone 'Africa/Cairo') t),
  -- one row per sales return document: device documents, then the imported ones (kind = 1)
  sr as (
    select r.number, r.issued_at, (r.issued_at at time zone 'Africa/Cairo')::date d, coalesce(c.name, '') party,
           coalesce(r.reason, 'unknown') reason,
           case r.refund_method when 'cash' then 'cash' when 'credit' then 'credit' else 'other' end method,
           r.total amount, false legacy
      from sales_returns r left join customers c on c.id = r.customer_id, lo, hi
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and r.is_legacy = false
       and r.issued_at >= lo.t and r.issued_at < hi.t
    union all
    select 'LG-RET-' || lpad(s.id::text, 6, '0'), (s.day::timestamp at time zone 'Africa/Cairo'), s.day, coalesce(c.name, ''),
           'unknown', 'legacy', s.total, true
      from legacy_sales s left join customers c on c.company_id = p_company and c.legacy_person_id = s.customer_id
     where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
  ),
  -- how each imported return was paid back, by method
  srm as (
    select 'cash' method, coalesce(sum(s.cash), 0) amount from legacy_sales s where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
    union all select 'card', coalesce(sum(s.card), 0) from legacy_sales s where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
    union all select 'credit', coalesce(sum(s.credit), 0) from legacy_sales s where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
    union all select 'other', coalesce(sum(s.other), 0) from legacy_sales s where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
    union all select sr.method, sum(sr.amount) from sr where not sr.legacy group by sr.method
  ),
  srl as (
    select coalesce(p.name, '') product, (l.qty * coalesce(o.unit_factor, 1000) / 1000) qty, l.net_amount amount
      from sales_return_lines l
      join sales_returns r on r.id = l.return_id
      left join products p on p.id = l.product_id
      left join sales_invoice_lines o on o.id = l.original_line_id, lo, hi
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and r.is_legacy = false
       and r.issued_at >= lo.t and r.issued_at < hi.t
    union all
    select coalesce(p.name, ll.text, ''), abs(ll.qty)::bigint, abs(ll.net)
      from legacy_sale_lines ll
      join legacy_sales s on s.id = ll.sale_id
      left join products p on p.company_id = p_company and p.legacy_item_id = ll.product_id
     where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
  ),
  pr as (
    select r.number, r.issued_at, (r.issued_at at time zone 'Africa/Cairo')::date d, coalesce(s.name, '') party, r.total amount, false legacy
      from purchase_returns r left join suppliers s on s.id = r.supplier_id, lo, hi
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and r.is_legacy = false
       and r.issued_at >= lo.t and r.issued_at < hi.t
    union all
    select 'LG-PRT-' || lpad(h.id::text, 6, '0'), (h.day::timestamp at time zone 'Africa/Cairo'), h.day, coalesce(s.name, ''), h.total, true
      from legacy_purchases h left join suppliers s on s.company_id = p_company and s.legacy_person_id = h.supplier_id
     where h.company_id = p_company and h.kind = 1 and h.day between p_from and p_to
  ),
  prl as (
    select coalesce(p.name, '') product, (l.qty * l.unit_factor / 1000) qty, l.net_amount amount
      from purchase_return_lines l
      join purchase_returns r on r.id = l.return_id
      left join products p on p.id = l.product_id, lo, hi
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and r.is_legacy = false
       and r.issued_at >= lo.t and r.issued_at < hi.t
    union all
    select coalesce(p.name, ll.text, ''), abs(ll.qty)::bigint, abs(ll.net)
      from legacy_purchase_lines ll
      join legacy_purchases h on h.id = ll.purchase_id
      left join products p on p.company_id = p_company and p.legacy_item_id = ll.product_id
     where h.company_id = p_company and h.kind = 1 and h.day between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales', jsonb_build_object(
      'total', jsonb_build_object('count', (select count(*) from sr), 'amount', coalesce((select sum(amount) from sr), 0)),
      'legacy_count', (select count(*) from sr where legacy),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n, 'amount', s) order by d)
          from (select d, count(*)::int n, sum(amount)::bigint s from sr group by d) x), '[]'),
      'by_product', coalesce((select jsonb_agg(jsonb_build_object('product', product, 'qty', q, 'amount', s) order by s desc, product)
          from (select product, sum(qty)::bigint q, sum(amount)::bigint s from srl group by product order by sum(amount) desc, product limit 300) x), '[]'),
      'by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'count', n, 'amount', s) order by s desc, reason)
          from (select reason, count(*)::int n, sum(amount)::bigint s from sr group by reason) x), '[]'),
      'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', s) order by s desc, method)
          from (select method, sum(amount)::bigint s from srm group by method having sum(amount) <> 0) x), '[]'),
      'list', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'at', issued_at, 'customer', party, 'reason', reason,
                  'method', method, 'amount', amount, 'legacy', legacy) order by issued_at desc, number)
          from (select * from sr order by issued_at desc, number limit 500) y), '[]')
    ),
    'purchases', jsonb_build_object(
      'total', jsonb_build_object('count', (select count(*) from pr), 'amount', coalesce((select sum(amount) from pr), 0)),
      'legacy_count', (select count(*) from pr where legacy),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n, 'amount', s) order by d)
          from (select d, count(*)::int n, sum(amount)::bigint s from pr group by d) x), '[]'),
      'by_product', coalesce((select jsonb_agg(jsonb_build_object('product', product, 'qty', q, 'amount', s) order by s desc, product)
          from (select product, sum(qty)::bigint q, sum(amount)::bigint s from prl group by product order by sum(amount) desc, product limit 300) x), '[]'),
      'by_supplier', coalesce((select jsonb_agg(jsonb_build_object('supplier', party, 'count', n, 'amount', s) order by s desc, party)
          from (select party, count(*)::int n, sum(amount)::bigint s from pr group by party) x), '[]'),
      'list', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'at', issued_at, 'supplier', party, 'amount', amount, 'legacy', legacy)
                  order by issued_at desc, number)
          from (select * from pr order by issued_at desc, number limit 500) y), '[]')
    )
  )
$$;

create function report_returns(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_returns_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;

revoke all on function report_returns_core(uuid, date, date) from public, anon, authenticated;
revoke all on function report_returns(date, date) from public, anon;
grant execute on function report_returns(date, date) to authenticated;
