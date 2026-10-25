-- The old-system tab of the sales invoices screen shows each imported invoice's profit (owner decision 2026-10-25):
-- a sale = net minus cost over its lines; a return row = minus that (negative), the same sign rule as the profit report.
create or replace function search_legacy_sales_core(
  p_company uuid, p_from date, p_to date, p_number text, p_customer text, p_min bigint, p_max bigint,
  p_method text, p_product text, p_kind int, p_offset int
) returns jsonb
language sql stable security definer set search_path = public as $$
  with hit as (
    select s.id, s.kind, s.day, s.customer_id, s.total, s.cash, s.card, s.credit, s.other,
           coalesce(c.name, '') customer
      from legacy_sales s
      left join customers c on c.company_id = s.company_id and c.legacy_person_id = s.customer_id
     where s.company_id = p_company
       and (p_from is null or s.day >= p_from) and (p_to is null or s.day <= p_to)
       and (p_kind is null or s.kind = p_kind)
       and (p_min is null or s.total >= p_min) and (p_max is null or s.total <= p_max)
       and (coalesce(p_number, '') = '' or s.id::text like '%' || regexp_replace(p_number, '\D', '', 'g') || '%')
       and (coalesce(p_customer, '') = '' or lower(coalesce(c.name, '')) like '%' || lower(p_customer) || '%')
       and (coalesce(p_method, '') = ''
            or (p_method = 'cash' and s.cash > 0) or (p_method = 'card' and s.card > 0)
            or (p_method = 'credit' and s.credit > 0) or (p_method = 'other' and s.other > 0))
       and (coalesce(p_product, '') = '' or exists (
            select 1 from legacy_sale_lines l
              left join products p on p.company_id = s.company_id and p.legacy_item_id = l.product_id
             where l.sale_id = s.id
               and (lower(coalesce(p.name, l.text, '')) like '%' || lower(p_product) || '%')))
  )
  select jsonb_build_object(
    'matched', (select count(*) from hit),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'number', case when kind = 1 then 'LG-RET-' else 'LG-INV-' end || lpad(id::text, 6, '0'), 'kind', kind, 'day', day,
        'customer', customer, 'total', total, 'cash', cash, 'card', card, 'credit', credit, 'other', other,
        'profit', coalesce((select sum(case when x.kind = 1 then -(abs(l.net) - abs(l.cost)) else l.net - l.cost end)
                              from legacy_sale_lines l where l.sale_id = x.id), 0)) order by day desc, id desc)
      from (select * from hit order by day desc, id desc offset greatest(p_offset, 0) limit 100) x), '[]'))
$$;
