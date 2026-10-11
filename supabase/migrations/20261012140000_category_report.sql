-- Sales by product category: revenue, cost, profit, quantity and invoices per category for a period (imported history included),
-- the stock value each category ties up, and revenue per day x category for the chart.
-- A product's category is its current one; lines of products that were deleted or never matched count under "no category" (null).
-- Revenue and cost follow report_profit_core (revenue after the invoice discount share; returns take both back).

create or replace function report_categories_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sold as (
    select (i.issued_at at time zone 'Africa/Cairo')::date d, i.id invoice_id, l.product_id,
           (l.qty * l.unit_factor / 1000) qty,
           (l.net_amount - l.alloc_discount) revenue,
           round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint cost
      from sales_invoices i join sales_invoice_lines l on l.invoice_id = i.id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and l.deleted_at is null
       and (i.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d, null::uuid invoice_id, l.product_id,
           -l.qty qty,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and l.deleted_at is null
       and (r.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), lines as (
    select u.*, p.category_id from (select * from sold union all select * from back) u
      left join products p on p.id = u.product_id and p.company_id = p_company
  ), per_cat as (
    select coalesce(category_id, '00000000-0000-0000-0000-000000000000') category_id, sum(qty)::bigint qty, sum(revenue)::bigint revenue, sum(cost)::bigint cost,
           count(distinct invoice_id)::int invoices
      from lines group by coalesce(category_id, '00000000-0000-0000-0000-000000000000')
  ), stock as (
    select coalesce(p.category_id, '00000000-0000-0000-0000-000000000000') category_id,
           count(*) filter (where p.type = 'stock')::int items,
           coalesce(sum(greatest(s.qty, 0) * p.unit_cost / 1000) filter (where p.type = 'stock'), 0)::bigint value
      from products p
      left join (select product_id, sum(qty) qty from stock_movements where company_id = p_company and deleted_at is null group by product_id) s on s.product_id = p.id
     where p.company_id = p_company and p.deleted_at is null and p.active
     group by coalesce(p.category_id, '00000000-0000-0000-0000-000000000000')
  ), cats as (
    select coalesce(pc.category_id, st.category_id) category_id,
           coalesce(pc.qty, 0) qty, coalesce(pc.revenue, 0) revenue, coalesce(pc.cost, 0) cost, coalesce(pc.invoices, 0) invoices,
           coalesce(st.items, 0) items, coalesce(st.value, 0) stock_value
      from per_cat pc full join stock st on st.category_id = pc.category_id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object('revenue', coalesce((select sum(revenue) from cats), 0), 'cost', coalesce((select sum(cost) from cats), 0),
        'qty', coalesce((select sum(qty) from cats), 0), 'stock_value', coalesce((select sum(stock_value) from cats), 0)),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', nullif(c.category_id, '00000000-0000-0000-0000-000000000000'), 'name', coalesce(g.name, ''), 'color', g.color_token, 'qty', c.qty,
          'revenue', c.revenue, 'cost', c.cost, 'profit', c.revenue - c.cost, 'invoices', c.invoices, 'items', c.items, 'stock_value', c.stock_value)
          order by c.revenue desc, g.name)
        from cats c left join categories g on g.id = c.category_id and g.company_id = p_company
       where c.revenue <> 0 or c.qty <> 0 or c.stock_value > 0), '[]'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'category', category_id, 'revenue', s) order by d)
        from (select d, category_id, sum(revenue)::bigint s from lines group by d, category_id) x), '[]')
  )
$$;

create or replace function report_categories(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_categories_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;

revoke all on function report_categories_core(uuid, date, date) from public, anon, authenticated;
revoke all on function report_categories(date, date) from public, anon;
grant execute on function report_categories(date, date) to authenticated;
