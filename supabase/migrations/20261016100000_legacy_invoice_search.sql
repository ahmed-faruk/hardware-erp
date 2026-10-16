-- Searching the imported OpenSourcePOS sales (they live on the server only, in the compact legacy tables). Manager devices, read-only.

create function search_legacy_sales_core(
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
        'customer', customer, 'total', total, 'cash', cash, 'card', card, 'credit', credit, 'other', other) order by day desc, id desc)
      from (select * from hit order by day desc, id desc offset greatest(p_offset, 0) limit 100) x), '[]'))
$$;

create function search_legacy_sales(
  p_from date default null, p_to date default null, p_number text default null, p_customer text default null,
  p_min bigint default null, p_max bigint default null, p_method text default null, p_product text default null,
  p_kind int default null, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'E_VALIDATION:فترة غير صالحة';
  end if;
  return jsonb_build_object('ok', true, 'data',
    search_legacy_sales_core(current_company(), p_from, p_to, p_number, p_customer, p_min, p_max, p_method, p_product, p_kind, p_offset));
end $$;

-- one imported sale with its lines, to read
create function legacy_sale_detail(p_id int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  co uuid := current_company();
  s legacy_sales;
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  select * into s from legacy_sales where id = p_id and company_id = co;
  if not found then
    raise exception 'E_VALIDATION:فاتورة غير موجودة';
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'day', s.day, 'total', s.total, 'cash', s.cash, 'card', s.card, 'credit', s.credit, 'other', s.other,
    'number', case when s.kind = 1 then 'LG-RET-' else 'LG-INV-' end || lpad(s.id::text, 6, '0'),
    'customer', coalesce((select c.name from customers c where c.company_id = co and c.legacy_person_id = s.customer_id), ''),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('product', coalesce(p.name, l.text, ''), 'qty', abs(l.qty), 'net', abs(l.net)) order by l.line_no)
        from legacy_sale_lines l left join products p on p.company_id = co and p.legacy_item_id = l.product_id
       where l.sale_id = s.id), '[]')));
end $$;

revoke all on function search_legacy_sales_core(uuid, date, date, text, text, bigint, bigint, text, text, int, int) from public, anon, authenticated;
revoke all on function search_legacy_sales(date, date, text, text, bigint, bigint, text, text, int, int) from public, anon;
revoke all on function legacy_sale_detail(int) from public, anon;
grant execute on function search_legacy_sales(date, date, text, text, bigint, bigint, text, text, int, int), legacy_sale_detail(int) to authenticated;
