-- The imported OpenSourcePOS history in compact tables.
-- Before: every old invoice line was a full row (8 UUIDs, sync columns, a JSON copy): ~300 MB of the 500 MB free tier.
-- Now: small integer rows with no UUIDs and no sync columns, never pulled by devices, read only by the report functions
-- (security definer): ~50 MB with the same detail (every invoice, line, payment split, return and purchase).
-- Products, customers, suppliers and workers are found through their legacy ids (products.legacy_item_id, customers.legacy_person_id,
-- suppliers.legacy_person_id, workers.legacy_employee_id). One company only (the shop): ids are OpenSourcePOS ids.

-- the move below deletes ~450,000 old rows: let it run as long as it needs
set local statement_timeout = 0;

create table legacy_sales (
  company_id uuid not null references companies (id),
  id int primary key,
  kind smallint not null check (kind in (0, 1)), -- 0 sale, 1 return
  day date not null, -- Cairo calendar day
  customer_id int,
  employee_id int,
  total bigint not null,
  cash bigint not null default 0,
  card bigint not null default 0,
  credit bigint not null default 0,
  other bigint not null default 0
);
create index legacy_sales_day_idx on legacy_sales (day);
create table legacy_sale_lines (
  sale_id int not null,
  line_no smallint not null,
  product_id int,
  text text, -- the name of a product that was not matched, otherwise null
  qty int not null, -- milli-units of the base unit
  net bigint not null, -- after discounts
  cost bigint not null, -- cost of the whole line
  primary key (sale_id, line_no)
);
create index legacy_sale_lines_product_idx on legacy_sale_lines (product_id);
create table legacy_purchases (
  company_id uuid not null references companies (id),
  id int primary key,
  kind smallint not null check (kind in (0, 1)), -- 0 purchase, 1 return
  day date not null,
  supplier_id int, -- null = the archive's unknown supplier
  total bigint not null,
  cash bigint not null default 0,
  credit bigint not null default 0,
  other bigint not null default 0
);
create index legacy_purchases_day_idx on legacy_purchases (day);
create table legacy_purchase_lines (
  purchase_id int not null,
  line_no smallint not null,
  product_id int,
  text text,
  qty int not null,
  net bigint not null,
  primary key (purchase_id, line_no)
);
create index legacy_purchase_lines_product_idx on legacy_purchase_lines (product_id);
create index products_legacy_item_idx on products (company_id, legacy_item_id) where legacy_item_id is not null;
create index customers_legacy_person_idx on customers (legacy_person_id) where legacy_person_id is not null;
create index suppliers_legacy_person_idx on suppliers (legacy_person_id) where legacy_person_id is not null;
create index workers_legacy_employee_idx on workers (legacy_employee_id) where legacy_employee_id is not null;
alter table legacy_sales enable row level security;
alter table legacy_sale_lines enable row level security;
alter table legacy_purchases enable row level security;
alter table legacy_purchase_lines enable row level security;
revoke all on legacy_sales, legacy_sale_lines, legacy_purchases, legacy_purchase_lines from anon, authenticated;

-- move what is already in the wide tables (staging) into the compact ones, then delete it there
insert into legacy_sales (company_id, id, kind, day, customer_id, employee_id, total, cash, card, credit, other)
select i.company_id, (i.legacy ->> 'ospos_id')::int, 0, (i.issued_at at time zone 'Africa/Cairo')::date, c.legacy_person_id, w.legacy_employee_id, i.total,
       coalesce(p.cash, 0), coalesce(p.card, 0), coalesce(p.credit, 0), coalesce(p.other, 0)
  from sales_invoices i
  left join customers c on c.id = i.customer_id
  left join workers w on w.id = i.worker_id
  left join (select document_id, sum(amount) filter (where method = 'cash') cash, sum(amount) filter (where method = 'card') card,
                    sum(amount) filter (where method = 'credit') credit, sum(amount) filter (where method not in ('cash', 'card', 'credit')) other
               from payments where is_legacy and document_type = 'sales_invoice' group by document_id) p on p.document_id = i.id
 where i.is_legacy and i.status = 'posted' and i.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_sales (company_id, id, kind, day, customer_id, employee_id, total, cash, card, credit, other)
select r.company_id, (r.legacy ->> 'ospos_id')::int, 1, (r.issued_at at time zone 'Africa/Cairo')::date, c.legacy_person_id, w.legacy_employee_id, r.total,
       coalesce(p.cash, 0), coalesce(p.card, 0), coalesce(p.credit, 0), coalesce(p.other, 0)
  from sales_returns r
  left join customers c on c.id = r.customer_id
  left join workers w on w.id = r.worker_id
  left join (select document_id, sum(amount) filter (where method = 'cash') cash, sum(amount) filter (where method = 'card') card,
                    sum(amount) filter (where method = 'credit') credit, sum(amount) filter (where method not in ('cash', 'card', 'credit')) other
               from payments where is_legacy and document_type = 'sales_return' group by document_id) p on p.document_id = r.id
 where r.is_legacy and r.status = 'posted' and r.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost)
select (i.legacy ->> 'ospos_id')::int, l.line_no, p.legacy_item_id, case when l.product_id is null then l.legacy_text end,
       ((l.qty * l.unit_factor) / 1000)::int, l.net_amount - l.alloc_discount, round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint
  from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id left join products p on p.id = l.product_id
 where l.is_legacy and i.is_legacy and i.status = 'posted' and i.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost)
select (r.legacy ->> 'ospos_id')::int, (row_number() over (partition by l.return_id order by l.id))::smallint, p.legacy_item_id, null,
       l.qty::int, l.net_amount, round(l.unit_cost::numeric * l.qty / 1000)::bigint
  from sales_return_lines l join sales_returns r on r.id = l.return_id left join products p on p.id = l.product_id
 where l.is_legacy and r.is_legacy and r.status = 'posted' and r.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_purchases (company_id, id, kind, day, supplier_id, total, cash, credit, other)
select i.company_id, (i.legacy ->> 'ospos_id')::int, 0, (i.issued_at at time zone 'Africa/Cairo')::date, s.legacy_person_id, i.total,
       coalesce(p.cash, 0), coalesce(p.credit, 0), coalesce(p.other, 0)
  from purchase_invoices i left join suppliers s on s.id = i.supplier_id
  left join (select document_id, sum(amount) filter (where method = 'cash') cash, sum(amount) filter (where method = 'credit') credit,
                    sum(amount) filter (where method not in ('cash', 'credit')) other
               from payments where is_legacy and document_type = 'purchase_invoice' group by document_id) p on p.document_id = i.id
 where i.is_legacy and i.status = 'posted' and i.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_purchases (company_id, id, kind, day, supplier_id, total, cash, credit, other)
select r.company_id, (r.legacy ->> 'ospos_id')::int, 1, (r.issued_at at time zone 'Africa/Cairo')::date, s.legacy_person_id, r.total,
       coalesce(p.cash, 0), coalesce(p.credit, 0), coalesce(p.other, 0)
  from purchase_returns r left join suppliers s on s.id = r.supplier_id
  left join (select document_id, sum(amount) filter (where method = 'cash') cash, sum(amount) filter (where method = 'credit') credit,
                    sum(amount) filter (where method not in ('cash', 'credit')) other
               from payments where is_legacy and document_type = 'purchase_return' group by document_id) p on p.document_id = r.id
 where r.is_legacy and r.status = 'posted' and r.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_purchase_lines (purchase_id, line_no, product_id, text, qty, net)
select (i.legacy ->> 'ospos_id')::int, l.line_no, p.legacy_item_id, case when l.product_id is null then l.legacy_text end, ((l.qty * l.unit_factor) / 1000)::int, l.net_amount
  from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id left join products p on p.id = l.product_id
 where l.is_legacy and i.is_legacy and i.status = 'posted' and i.legacy ->> 'ospos_id' is not null
on conflict do nothing;
insert into legacy_purchase_lines (purchase_id, line_no, product_id, text, qty, net)
select (r.legacy ->> 'ospos_id')::int, l.line_no, p.legacy_item_id, case when l.product_id is null then l.legacy_text end, ((l.qty * l.unit_factor) / 1000)::int, l.net_amount
  from purchase_return_lines l join purchase_returns r on r.id = l.return_id left join products p on p.id = l.product_id
 where l.is_legacy and r.is_legacy and r.status = 'posted' and r.legacy ->> 'ospos_id' is not null
on conflict do nothing;
-- children before parents, and returns before the invoices they point at, so no foreign-key check has to scan a big table
delete from payments where is_legacy;
delete from sales_return_lines where is_legacy;
delete from sales_returns where is_legacy;
delete from sales_invoice_lines where is_legacy;
delete from sales_invoices where is_legacy;
delete from purchase_return_lines where is_legacy;
delete from purchase_returns where is_legacy;
delete from purchase_invoice_lines where is_legacy;
delete from purchase_invoices where is_legacy;


-- reports: the wide tables hold only what happened on devices; the compact tables hold the imported history
create or replace function report_sales_summary_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (
    select (issued_at at time zone 'Africa/Cairo')::date d, id, worker_id, total, false is_legacy
      from sales_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, null::uuid, w.id, s.total, true
      from legacy_sales s left join workers w on w.company_id = s.company_id and w.legacy_employee_id = s.employee_id
     where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
  ), ret as (
    select (issued_at at time zone 'Africa/Cairo')::date d, total
      from sales_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, s.total from legacy_sales s where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
  ), days as (
    select d, count(*)::int invoices, sum(total)::bigint gross, 0::bigint returns from inv group by d
    union all select d, 0, 0, sum(total)::bigint from ret group by d
  ), per_day as (
    select d, sum(invoices)::int invoices, sum(gross)::bigint gross, sum(returns)::bigint returns from days group by d
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'invoices', invoices, 'gross', gross, 'returns', returns, 'net', gross - returns) order by d) from per_day), '[]'),
    'total', jsonb_build_object(
      'invoices', coalesce((select sum(invoices) from per_day), 0),
      'gross', coalesce((select sum(gross) from per_day), 0),
      'returns', coalesce((select sum(returns) from per_day), 0),
      'net', coalesce((select sum(gross - returns) from per_day), 0)),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount', amount) order by method)
        from (select method, sum(amount)::bigint amount
                from (select p.method, p.amount from payments p join inv on inv.id = p.document_id
                       where p.document_type = 'sales_invoice' and p.company_id = p_company
                      union all select 'cash', s.cash from legacy_sales s where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
                      union all select 'card', s.card from legacy_sales s where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
                      union all select 'credit', s.credit from legacy_sales s where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
                      union all select 'other', s.other from legacy_sales s where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to) u
               where amount > 0 group by method) m), '[]'),
    'by_worker', coalesce((
      select jsonb_agg(jsonb_build_object('worker', coalesce(w.name, '—'), 'invoices', c, 'gross', g) order by g desc)
        from (select worker_id, count(*)::int c, sum(total)::bigint g from inv group by worker_id) x
        left join workers w on w.id = x.worker_id), '[]'),
    'legacy_invoices', coalesce((select count(*) from inv where is_legacy), 0)
  )
$$;

create or replace function report_profit_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sold as (
    select (i.issued_at at time zone 'Africa/Cairo')::date d,
           (l.net_amount - l.alloc_discount) revenue,
           round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint cost
      from sales_invoices i join sales_invoice_lines l on l.invoice_id = i.id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, l.net, l.cost
      from legacy_sales s join legacy_sale_lines l on l.sale_id = s.id
     where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null
       and r.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and r.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, -l.net, -l.cost
      from legacy_sales s join legacy_sale_lines l on l.sale_id = s.id
     where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
  ), per_day as (
    select d, sum(revenue)::bigint revenue, sum(cost)::bigint cost from (select * from sold union all select * from back) u group by d
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'revenue', revenue, 'cost', cost, 'profit', revenue - cost) order by d) from per_day), '[]'),
    'total', jsonb_build_object(
      'revenue', coalesce((select sum(revenue) from per_day), 0),
      'cost', coalesce((select sum(cost) from per_day), 0),
      'profit', coalesce((select sum(revenue - cost) from per_day), 0))
  )
$$;


create or replace function report_purchases_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with unknown_supplier as (
    select id from suppliers where company_id = p_company and legacy_person_id is null and not active and name = 'مورد غير محدد (أرشيف قديم)' limit 1
  ), lp as (
    select coalesce(s.id, (select id from unknown_supplier)) supplier_id, p.kind, p.total, p.cash, p.credit, p.other
      from legacy_purchases p left join suppliers s on s.company_id = p.company_id and s.legacy_person_id = p.supplier_id
     where p.company_id = p_company and p.day between p_from and p_to
  ), inv as (
    select id, supplier_id, total, is_legacy
      from purchase_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  ), pay0 as (
    select inv.supplier_id,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)::bigint safe,
           coalesce(sum(p.amount) filter (where p.method = 'owner'), 0)::bigint owner,
           coalesce(sum(p.amount) filter (where p.method in ('card', 'instapay', 'wallet', 'other')), 0)::bigint other,
           coalesce(sum(p.amount) filter (where p.method = 'credit'), 0)::bigint credit
      from inv join payments p on p.document_id = inv.id and p.document_type = 'purchase_invoice' and p.company_id = p_company and p.deleted_at is null
     group by inv.supplier_id
    union all
    select supplier_id, coalesce(sum(cash), 0)::bigint, 0::bigint, coalesce(sum(other), 0)::bigint, coalesce(sum(credit), 0)::bigint from lp where kind = 0 group by supplier_id
  ), pay as (
    select supplier_id, sum(safe)::bigint safe, sum(owner)::bigint owner, sum(other)::bigint other, sum(credit)::bigint credit from pay0 group by supplier_id
  ), tot as (
    select supplier_id, count(*)::int invoices, sum(total)::bigint total
      from (select supplier_id, total from inv union all select supplier_id, total from lp where kind = 0) u group by supplier_id
  ), ret as (
    select supplier_id, sum(returns)::bigint returns from (
    select supplier_id, total returns from lp where kind = 1
    union all
    select supplier_id, total
      from purchase_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    ) r2 group by supplier_id
  ), later as (
    select supplier_id,
           coalesce(sum(amount) filter (where method = 'owner'), 0)::bigint owner,
           coalesce(sum(amount) filter (where method <> 'owner'), 0)::bigint other
      from supplier_payments
     where company_id = p_company and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
     group by supplier_id
  ), per as (
    select s.id supplier_id, s.name,
           coalesce(tot.invoices, 0) invoices, coalesce(tot.total, 0) total,
           coalesce(pay.safe, 0) safe, coalesce(pay.owner, 0) owner, coalesce(pay.other, 0) other, coalesce(pay.credit, 0) credit,
           coalesce(ret.returns, 0) returns, coalesce(later.owner, 0) later_owner, coalesce(later.other, 0) later_other
      from suppliers s
      left join tot on tot.supplier_id = s.id left join pay on pay.supplier_id = s.id
      left join ret on ret.supplier_id = s.id left join later on later.supplier_id = s.id
     where s.company_id = p_company
       and (tot.supplier_id is not null or ret.supplier_id is not null or later.supplier_id is not null)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object(
      'invoices', coalesce((select sum(invoices) from per), 0), 'total', coalesce((select sum(total) from per), 0),
      'safe', coalesce((select sum(safe) from per), 0), 'owner', coalesce((select sum(owner) from per), 0),
      'other', coalesce((select sum(other) from per), 0), 'credit', coalesce((select sum(credit) from per), 0),
      'returns', coalesce((select sum(returns) from per), 0),
      'later_owner', coalesce((select sum(later_owner) from per), 0), 'later_other', coalesce((select sum(later_other) from per), 0)),
    'by_supplier', coalesce((select jsonb_agg(jsonb_build_object('supplier', name, 'invoices', invoices, 'total', total, 'safe', safe, 'owner', owner,
        'other', other, 'credit', credit, 'returns', returns, 'later_owner', later_owner, 'later_other', later_other) order by total desc, name) from per), '[]'),
    'legacy_invoices', coalesce((select count(*) from lp where kind = 0), 0) + coalesce((select count(*) from inv where is_legacy), 0)
  )
$$;

create or replace function report_categories_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sold as (
    select (i.issued_at at time zone 'Africa/Cairo')::date d, i.id::text invoice_key, l.product_id,
           (l.qty * l.unit_factor / 1000) qty,
           (l.net_amount - l.alloc_discount) revenue,
           round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint cost
      from sales_invoices i join sales_invoice_lines l on l.invoice_id = i.id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and l.deleted_at is null
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, 'L' || s.id, p.id, l.qty, l.net, l.cost
      from legacy_sales s join legacy_sale_lines l on l.sale_id = s.id
      left join products p on p.company_id = s.company_id and p.legacy_item_id = l.product_id
     where s.company_id = p_company and s.kind = 0 and s.day between p_from and p_to
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d, null::text invoice_key, l.product_id,
           -l.qty qty,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and l.deleted_at is null
       and r.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and r.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
    union all
    select s.day, null::text, p.id, -l.qty, -l.net, -l.cost
      from legacy_sales s join legacy_sale_lines l on l.sale_id = s.id
      left join products p on p.company_id = s.company_id and p.legacy_item_id = l.product_id
     where s.company_id = p_company and s.kind = 1 and s.day between p_from and p_to
  ), lines as (
    select u.*, p.category_id from (select * from sold union all select * from back) u
      left join products p on p.id = u.product_id and p.company_id = p_company
  ), per_cat as (
    select coalesce(category_id, '00000000-0000-0000-0000-000000000000') category_id, sum(qty)::bigint qty, sum(revenue)::bigint revenue, sum(cost)::bigint cost,
           count(distinct invoice_key)::int invoices
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
           coalesce(r.lparty, c1.name, c2.name, s1.name, s2.name) party
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

-- service role only: bulk insert into the compact history tables, idempotent (a row that is already there is skipped)
create or replace function import_legacy_batch(p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n int;
  cols text;
  bad text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'E_FORBIDDEN';
  end if;
  if p_kind not in ('legacy_sales', 'legacy_sale_lines', 'legacy_purchases', 'legacy_purchase_lines') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'جدول غير مسموح'));
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'دفعة غير صالحة'));
  end if;
  select string_agg(k, ', ') into bad
    from jsonb_object_keys(p_rows -> 0) k
   where k not in (select attname::text from pg_attribute where attrelid = ('public.' || quote_ident(p_kind))::regclass and attnum > 0 and not attisdropped);
  if bad is not null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'E_VALIDATION', 'message', 'حقول غير معروفة: ' || bad));
  end if;
  perform pg_advisory_xact_lock(7300001);
  -- only the columns the rows carry: the others keep their defaults
  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict do nothing', p_kind, cols, cols, p_kind) using p_rows;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('inserted', n, 'skipped', jsonb_array_length(p_rows) - n));
end $$;
revoke execute on function import_legacy_batch(text, jsonb) from public, anon;
grant execute on function import_legacy_batch(text, jsonb) to authenticated, service_role;
