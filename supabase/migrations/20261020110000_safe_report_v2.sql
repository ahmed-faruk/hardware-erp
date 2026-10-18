-- «الخزنة» v2 (owner decision 2026-10-19), every part by its document date:
-- sales = cash that came into the box (cash part of invoices + cash collections − cash refunds + old-system cash sales − old cash returns);
-- purchases = cash that left the box for suppliers (cash on invoices + cash supplier payments − cash back from purchase returns + old cash
-- purchases − old cash purchase returns); shop expenses = «مصروفات محل» from the box + every old-system expense; payroll = advances +
-- salaries paid. Net = sales − purchases − expenses − payroll. Transfers (card, InstaPay, wallet, other), owner-paid money and expenses
-- from outside the box are listed but not counted. Every line and its drill-down come from the same rows (safe_rows).

create or replace function safe_rows(p_company uuid, p_from date, p_to date)
returns table (line_key text, happened_at timestamptz, doc_number text, party_name text, pay_method text, line_amount bigint, doc_source text)
language sql stable security definer set search_path = public as $$
  with b as (
    select (p_from::timestamp at time zone 'Africa/Cairo') lo, ((p_to + 1)::timestamp at time zone 'Africa/Cairo') hi
  )
  -- sales invoices: the cash part counts; card, InstaPay, wallet and other are transfers; credit is not money
  select case when p.method = 'cash' then 'cash_sales' else 'transfers_sales' end, i.issued_at, i.number, c.name, p.method, p.amount, 'sales_invoices'
    from payments p join sales_invoices i on i.id = p.document_id left join customers c on c.id = i.customer_id, b
   where p.company_id = p_company and p.document_type = 'sales_invoice' and p.deleted_at is null
     and p.method in ('cash', 'card', 'instapay', 'wallet', 'other')
     and i.status = 'posted' and not i.is_legacy and i.deleted_at is null and i.issued_at >= b.lo and i.issued_at < b.hi
  union all
  -- customer collections, by collection date
  select case when r.method = 'cash' then 'cash_receipts' else 'transfers_receipts' end, r.issued_at, r.number, c.name, r.method, r.amount, 'customer_receipts'
    from customer_receipts r left join customers c on c.id = r.customer_id, b
   where r.company_id = p_company and r.status = 'posted' and not r.is_legacy and r.deleted_at is null
     and r.method in ('cash', 'card', 'instapay', 'wallet', 'other') and r.issued_at >= b.lo and r.issued_at < b.hi
  union all
  -- cash refunded on sales returns (the refund's cash rows)
  select 'cash_sales_returns', r.issued_at, r.number, c.name, 'cash', -m.amount, 'sales_returns'
    from cash_movements m join sales_returns r on r.id = m.doc_id left join customers c on c.id = r.customer_id, b
   where m.company_id = p_company and m.doc_type = 'sales_return' and m.deleted_at is null
     and r.status = 'posted' and not r.is_legacy and r.deleted_at is null and r.issued_at >= b.lo and r.issued_at < b.hi
  union all
  -- the old system: cash sales and cash returns
  select case s.kind when 0 then 'legacy_cash_sales' else 'legacy_cash_sales_returns' end, (s.day::timestamp at time zone 'Africa/Cairo'),
         'LG-' || case s.kind when 0 then 'INV' else 'RET' end || '-' || lpad(s.id::text, 6, '0'), c.name, 'cash', s.cash, 'legacy_sales'
    from legacy_sales s left join customers c on c.company_id = s.company_id and c.legacy_person_id = s.customer_id
   where s.company_id = p_company and s.day between p_from and p_to and s.cash <> 0
  union all
  -- the old system: card and other parts of its sales are transfers
  select 'transfers_sales', (s.day::timestamp at time zone 'Africa/Cairo'), 'LG-INV-' || lpad(s.id::text, 6, '0'), c.name, 'card', s.card + s.other, 'legacy_sales'
    from legacy_sales s left join customers c on c.company_id = s.company_id and c.legacy_person_id = s.customer_id
   where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to and s.card + s.other <> 0
  union all
  -- purchase invoices: cash from the box counts; transfers and owner-paid money are listed only
  select case when p.method = 'cash' then 'cash_purchases' when p.method = 'owner' then 'owner_paid' else 'transfers_purchases' end,
         i.issued_at, i.number, sp.name, p.method, p.amount, 'purchase_invoices'
    from payments p join purchase_invoices i on i.id = p.document_id left join suppliers sp on sp.id = i.supplier_id, b
   where p.company_id = p_company and p.document_type = 'purchase_invoice' and p.deleted_at is null
     and p.method in ('cash', 'card', 'instapay', 'wallet', 'other', 'owner')
     and i.status = 'posted' and not i.is_legacy and i.deleted_at is null and i.issued_at >= b.lo and i.issued_at < b.hi
  union all
  -- supplier payments, by payment date
  select case when s.method = 'cash' then 'cash_supplier_payments' when s.method = 'owner' then 'owner_paid' else 'transfers_purchases' end,
         s.issued_at, s.number, sp.name, s.method, s.amount, 'supplier_payments'
    from supplier_payments s left join suppliers sp on sp.id = s.supplier_id, b
   where s.company_id = p_company and s.status = 'posted' and not s.is_legacy and s.deleted_at is null
     and s.method in ('cash', 'card', 'instapay', 'wallet', 'other', 'owner') and s.issued_at >= b.lo and s.issued_at < b.hi
  union all
  -- cash that came back into the box from purchase returns
  select 'cash_purchase_returns', r.issued_at, r.number, sp.name, 'cash', m.amount, 'purchase_returns'
    from cash_movements m join purchase_returns r on r.id = m.doc_id left join suppliers sp on sp.id = r.supplier_id, b
   where m.company_id = p_company and m.doc_type = 'purchase_return' and m.deleted_at is null
     and r.status = 'posted' and not r.is_legacy and r.deleted_at is null and r.issued_at >= b.lo and r.issued_at < b.hi
  union all
  -- the old system: cash purchases and cash purchase returns
  select case l.kind when 0 then 'legacy_cash_purchases' else 'legacy_cash_purchase_returns' end, (l.day::timestamp at time zone 'Africa/Cairo'),
         'LG-' || case l.kind when 0 then 'PUR' else 'PRT' end || '-' || lpad(l.id::text, 6, '0'), sp.name, 'cash', l.cash, 'legacy_purchases'
    from legacy_purchases l left join suppliers sp on sp.company_id = l.company_id and sp.legacy_person_id = l.supplier_id
   where l.company_id = p_company and l.day between p_from and p_to and l.cash <> 0
  union all
  -- expenses: «مصروفات محل» from the box, every old-system expense, and (listed only) expenses from outside the box
  select case when e.is_legacy then 'legacy_expenses' when e.source = 'owner' then 'outside_expenses' else 'shop_expenses' end,
         e.issued_at, e.number, ec.name, case when e.source = 'owner' then 'owner' else 'cash' end, e.amount, 'expenses'
    from expenses e left join expense_categories ec on ec.id = e.category_id, b
   where e.company_id = p_company and e.status = 'posted' and e.deleted_at is null and e.issued_at >= b.lo and e.issued_at < b.hi
     and (e.is_legacy or e.source = 'owner' or ec.name = 'مصروفات محل')
  union all
  -- payroll: advances and the salaries actually paid
  select case pe.kind when 'advance' then 'advances' else 'salaries' end, pe.issued_at, pe.number, w.name, 'cash', pe.amount, 'payroll_entries'
    from payroll_entries pe left join workers w on w.id = pe.employee_id, b
   where pe.company_id = p_company and pe.status = 'posted' and not pe.is_legacy and pe.deleted_at is null
     and pe.kind in ('advance', 'salary') and pe.amount > 0 and pe.issued_at >= b.lo and pe.issued_at < b.hi
$$;
revoke all on function safe_rows(uuid, date, date) from public, anon, authenticated;

create or replace function report_safe_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select line_key, count(*)::int n, coalesce(sum(line_amount), 0)::bigint a from safe_rows(p_company, p_from, p_to) group by line_key
  ), def (sec, sec_ord, line_key, sgn, ord) as (
    values ('sales', 1, 'cash_sales', 1, 1), ('sales', 1, 'cash_receipts', 1, 2), ('sales', 1, 'cash_sales_returns', -1, 3),
           ('sales', 1, 'legacy_cash_sales', 1, 4), ('sales', 1, 'legacy_cash_sales_returns', -1, 5),
           ('purchases', 2, 'cash_purchases', 1, 1), ('purchases', 2, 'cash_supplier_payments', 1, 2), ('purchases', 2, 'cash_purchase_returns', -1, 3),
           ('purchases', 2, 'legacy_cash_purchases', 1, 4), ('purchases', 2, 'legacy_cash_purchase_returns', -1, 5),
           ('expenses', 3, 'shop_expenses', 1, 1), ('expenses', 3, 'legacy_expenses', 1, 2),
           ('payroll', 4, 'advances', 1, 1), ('payroll', 4, 'salaries', 1, 2),
           ('excluded', 5, 'transfers_sales', 0, 1), ('excluded', 5, 'transfers_receipts', 0, 2), ('excluded', 5, 'transfers_purchases', 0, 3),
           ('excluded', 5, 'owner_paid', 0, 4), ('excluded', 5, 'outside_expenses', 0, 5)
  ), lines as (
    select d.sec, d.sec_ord, d.line_key, d.sgn, d.ord, coalesce(r.a, 0)::bigint amount, coalesce(r.n, 0) cnt
      from def d left join r on r.line_key = d.line_key
  ), secs as (
    select sec, sec_ord, sum(sgn * amount)::bigint total from lines group by sec, sec_ord
  ), today as (
    select (now() at time zone 'Africa/Cairo')::date d
  ), rets as (
    select count(*)::int c, coalesce(sum(total), 0)::bigint t from sales_returns r, today
     where r.company_id = p_company and r.deleted_at is null and r.status = 'posted' and (r.issued_at at time zone 'Africa/Cairo')::date = today.d
  ), vds as (
    select count(*)::int c, coalesce(sum(i.total), 0)::bigint t from voids v join sales_invoices i on i.id = v.target_id, today
     where v.company_id = p_company and v.deleted_at is null and v.target_type = 'sales_invoice' and (v.issued_at at time zone 'Africa/Cairo')::date = today.d
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sections', (select jsonb_agg(jsonb_build_object('key', s.sec, 'total', s.total,
        'lines', (select jsonb_agg(jsonb_build_object('key', l.line_key, 'sign', l.sgn, 'amount', l.amount, 'count', l.cnt) order by l.ord)
                    from lines l where l.sec = s.sec))
        order by s.sec_ord) from secs s),
    'net', (select coalesce(sum(case when sec = 'sales' then total else -total end), 0)::bigint from secs where sec <> 'excluded'),
    'legacy_count', (select count(*) from legacy_sales where company_id = p_company and day between p_from and p_to)
                  + (select count(*) from legacy_purchases where company_id = p_company and day between p_from and p_to),
    'cash_now', jsonb_build_object('total', (select coalesce(sum(m.amount), 0)::bigint from cash_movements m where m.company_id = p_company and m.deleted_at is null)),
    'returns_today', jsonb_build_object('returns_count', (select c from rets), 'returns_total', (select t from rets),
      'voided_count', (select c from vds), 'voided_total', (select t from vds), 'today_total', (select t from rets) + (select t from vds))
  )
$$;

create or replace function report_safe_detail_core(p_company uuid, p_from date, p_to date, p_key text, p_offset int) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as materialized (
    select * from safe_rows(p_company, p_from, p_to) where line_key = p_key
  )
  select jsonb_build_object(
    'key', p_key,
    'count', (select count(*) from s),
    'total', (select coalesce(sum(line_amount), 0)::bigint from s),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('at', happened_at, 'number', doc_number, 'party', party_name, 'method', pay_method,
        'amount', line_amount, 'source', doc_source) order by happened_at desc, doc_number desc)
      from (select * from s order by happened_at desc, doc_number desc offset p_offset limit 200) x), '[]'::jsonb))
$$;
revoke all on function report_safe_detail_core(uuid, date, date, text, int) from public, anon, authenticated;

-- one line of «الخزنة» with the documents it was added up from (200 per page, newest first)
create or replace function report_safe_detail(p_from date, p_to date, p_key text, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := report_guard(p_from, p_to);
begin
  if p_key is null or p_key not in ('cash_sales', 'cash_receipts', 'cash_sales_returns', 'legacy_cash_sales', 'legacy_cash_sales_returns',
       'cash_purchases', 'cash_supplier_payments', 'cash_purchase_returns', 'legacy_cash_purchases', 'legacy_cash_purchase_returns',
       'shop_expenses', 'legacy_expenses', 'advances', 'salaries',
       'transfers_sales', 'transfers_receipts', 'transfers_purchases', 'owner_paid', 'outside_expenses')
     or coalesce(p_offset, 0) < 0 then
    raise exception 'E_VALIDATION:بند غير صالح';
  end if;
  return jsonb_build_object('ok', true, 'data', report_safe_detail_core(c, p_from, p_to, p_key, coalesce(p_offset, 0)), 'generated_at', now());
end $$;
revoke all on function report_safe_detail(date, date, text, int) from public, anon;
grant execute on function report_safe_detail(date, date, text, int) to authenticated;
