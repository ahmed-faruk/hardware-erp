-- Purchases report: the invoices under each supplier, their count and their top products (device invoices and the imported archive). Manager devices only.

create function report_purchases_suppliers_core(p_company uuid, p_from date, p_to date, p_supplier uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with unknown_supplier as (
    select id from suppliers where company_id = p_company and legacy_person_id is null and not active and name = 'مورد غير محدد (أرشيف قديم)' limit 1
  ), inv as (
    select i.id::text as key, i.supplier_id, i.number, (i.issued_at at time zone 'Africa/Cairo')::date as day, i.total
      from purchase_invoices i
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
       and (p_supplier is null or i.supplier_id = p_supplier)
    union all
    select 'L' || p.id, coalesce(s.id, (select id from unknown_supplier)), 'LG-PUR-' || lpad(p.id::text, 6, '0'), p.day, p.total
      from legacy_purchases p left join suppliers s on s.company_id = p.company_id and s.legacy_person_id = p.supplier_id
     where p.company_id = p_company and p.kind = 0 and p.day between p_from and p_to
       and (p_supplier is null or coalesce(s.id, (select id from unknown_supplier)) = p_supplier)
  ), lines as (
    select inv.supplier_id, coalesce(pr.name, '') as name, l.net_amount net
      from inv join purchase_invoice_lines l on l.invoice_id::text = inv.key and l.deleted_at is null
      left join products pr on pr.id = l.product_id
    union all
    select inv.supplier_id, coalesce(pr.name, l.text, ''), l.net
      from inv join legacy_purchase_lines l on 'L' || l.purchase_id = inv.key
      left join products pr on pr.company_id = p_company and pr.legacy_item_id = l.product_id
  ), top as (
    select supplier_id, name, sum(net)::bigint as net,
           row_number() over (partition by supplier_id order by sum(net) desc, name) rn
      from lines where name <> '' group by supplier_id, name
  ), per as (
    select supplier_id, count(*)::int as invoices, sum(total)::bigint as total from inv group by supplier_id
  )
  select jsonb_build_object('from', p_from, 'to', p_to, 'suppliers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'supplier_id', s.id, 'name', s.name, 'invoices', per.invoices, 'total', per.total,
      'list', (select coalesce(jsonb_agg(jsonb_build_object('number', x.number, 'day', x.day, 'total', x.total) order by x.day desc, x.number desc), '[]')
                 from (select * from inv where inv.supplier_id = s.id order by day desc, number desc limit 100) x),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'net', t.net) order by t.rn), '[]') from top t where t.supplier_id = s.id and t.rn <= 5))
      order by per.total desc, s.name)
    from per join suppliers s on s.id = per.supplier_id), '[]'))
$$;

create function report_purchases_suppliers(p_from date, p_to date, p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_purchases_suppliers_core(report_guard(p_from, p_to), p_from, p_to, p_supplier), 'generated_at', now());
end $$;

revoke all on function report_purchases_suppliers_core(uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function report_purchases_suppliers(date, date, uuid) from public, anon;
grant execute on function report_purchases_suppliers(date, date, uuid) to authenticated;
