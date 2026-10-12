-- Report speed: date filters the planner can use an index for (the old `(x at time zone ...)::date between` hid the column), and the missing indexes.
-- Same results: supabase/perf/fingerprint.sql gives identical lines before and after.

create or replace function report_sales_summary_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (
    select (issued_at at time zone 'Africa/Cairo')::date d, id, worker_id, total, is_legacy
      from sales_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  ), ret as (
    select (issued_at at time zone 'Africa/Cairo')::date d, total
      from sales_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
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
        from (select p.method, sum(p.amount)::bigint amount from payments p join inv on inv.id = p.document_id
               where p.document_type = 'sales_invoice' and p.company_id = p_company group by p.method) m), '[]'),
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
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null
       and r.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and r.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
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

create or replace function report_exceptions_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select (jsonb_build_object(
    'from', p_from, 'to', p_to,
    'voids', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'at', v.issued_at, 'reason', v.reason, 'worker', coalesce(w.name, '—')) order by v.issued_at)
      from voids v left join workers w on w.id = v.worker_id
     where v.company_id = p_company and v.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and v.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'reprints', (select count(*) from audit_log a where a.company_id = p_company and a.action = 'invoice_reprinted'
                  and a.occurred_at >= (p_from::timestamp at time zone 'Africa/Cairo') and a.occurred_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')),
    'no_sales', coalesce((select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by a.occurred_at)
      from audit_log a left join workers w on w.id = a.worker_id left join workers m on m.id = a.approved_by
     where a.company_id = p_company and a.action = 'no_sale' and a.occurred_at >= (p_from::timestamp at time zone 'Africa/Cairo') and a.occurred_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'discounts', (select jsonb_build_object('lines', count(*), 'amount', coalesce(sum(l.line_discount + l.alloc_discount), 0))
      from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
     where i.company_id = p_company and i.status = 'posted' and not i.is_legacy and (l.line_discount + l.alloc_discount) > 0
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')),
    'stock_adjustments', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'at', s.issued_at, 'reason', s.reason_code, 'approved_by', coalesce(m.name, '—')) order by s.issued_at)
      from stock_adjustments s left join workers m on m.id = s.approved_by
     where s.company_id = p_company and s.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and s.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]'),
    'shift_variances', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'variance', s.variance, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by s.closed_at)
      from shifts s left join workers w on w.id = s.worker_id left join workers m on m.id = s.approved_by
     where s.company_id = p_company and s.status = 'closed' and s.variance <> 0
       and s.closed_at >= (p_from::timestamp at time zone 'Africa/Cairo') and s.closed_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), '[]')
  )) || report_audit_extras_core(p_company, p_from, p_to)
$$;

create or replace function report_purchases_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (
    select id, supplier_id, total, is_legacy
      from purchase_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  ), pay as (
    select inv.supplier_id,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)::bigint safe,
           coalesce(sum(p.amount) filter (where p.method = 'owner'), 0)::bigint owner,
           coalesce(sum(p.amount) filter (where p.method in ('card', 'instapay', 'wallet', 'other')), 0)::bigint other,
           coalesce(sum(p.amount) filter (where p.method = 'credit'), 0)::bigint credit
      from inv join payments p on p.document_id = inv.id and p.document_type = 'purchase_invoice' and p.company_id = p_company and p.deleted_at is null
     group by inv.supplier_id
  ), tot as (
    select supplier_id, count(*)::int invoices, sum(total)::bigint total from inv group by supplier_id
  ), ret as (
    select supplier_id, sum(total)::bigint returns
      from purchase_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
     group by supplier_id
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
    'legacy_invoices', coalesce((select count(*) from inv where is_legacy), 0)
  )
$$;

create or replace function report_categories_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sold as (
    select (i.issued_at at time zone 'Africa/Cairo')::date d, i.id invoice_id, l.product_id,
           (l.qty * l.unit_factor / 1000) qty,
           (l.net_amount - l.alloc_discount) revenue,
           round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint cost
      from sales_invoices i join sales_invoice_lines l on l.invoice_id = i.id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and l.deleted_at is null
       and i.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and i.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d, null::uuid invoice_id, l.product_id,
           -l.qty qty,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null and l.deleted_at is null
       and r.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and r.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
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

create or replace function report_payroll_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with en as (
    select p.*, coalesce(w.name, '') employee
      from payroll_entries p left join workers w on w.id = p.employee_id
     where p.company_id = p_company and p.status = 'posted' and p.deleted_at is null
       and p.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and p.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  ), per as (
    select employee_id, employee,
           coalesce(sum(amount) filter (where kind = 'advance'), 0)::bigint advances,
           coalesce(sum(amount) filter (where kind = 'deduction'), 0)::bigint deductions,
           coalesce(sum(gross) filter (where kind = 'salary'), 0)::bigint salary,
           coalesce(sum(net) filter (where kind = 'salary'), 0)::bigint net_paid,
           (array_agg(carry_out order by issued_at desc) filter (where kind = 'salary'))[1] carry_out,
           count(*)::int entries
      from en group by employee_id, employee
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object('advances', coalesce((select sum(advances) from per), 0), 'deductions', coalesce((select sum(deductions) from per), 0),
        'salary', coalesce((select sum(salary) from per), 0), 'net_paid', coalesce((select sum(net_paid) from per), 0), 'entries', coalesce((select sum(entries) from per), 0)),
    'by_worker', coalesce((select jsonb_agg(jsonb_build_object('employee', employee, 'advances', advances, 'deductions', deductions, 'salary', salary,
        'net_paid', net_paid, 'carry_out', coalesce(carry_out, 0), 'entries', entries) order by employee) from per), '[]'),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'at', issued_at, 'employee', employee, 'kind', kind, 'month', month,
        'amount', amount, 'net', net, 'carry_out', carry_out, 'note', notes) order by issued_at desc, number)
        from (select * from en order by issued_at desc, number limit 1000) y), '[]')
  )
$$;

create or replace function report_expenses_base_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with ex as (
    select e.id, e.number, e.issued_at, (e.issued_at at time zone 'Africa/Cairo')::date d, e.amount, e.is_legacy, e.notes,
           coalesce(c.name, '') category, a.name account
      from expenses e
      left join expense_categories c on c.id = e.category_id
      left join cash_accounts a on a.id = e.cash_account_id
     where e.company_id = p_company and e.status = 'posted' and e.deleted_at is null
       and e.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and e.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', jsonb_build_object('count', (select count(*) from ex), 'amount', coalesce((select sum(amount) from ex), 0)),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'count', n, 'amount', s) order by s desc, category)
        from (select category, count(*)::int n, sum(amount)::bigint s from ex group by category) x), '[]'),
    'by_account', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'count', n, 'amount', s) order by s desc, account nulls last)
        from (select account, count(*)::int n, sum(amount)::bigint s from ex group by account) x), '[]'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'count', n, 'amount', s) order by d)
        from (select d, count(*)::int n, sum(amount)::bigint s from ex group by d) x), '[]'),
    'list', coalesce((select jsonb_agg(jsonb_build_object('number', number, 'at', issued_at, 'category', category, 'account', account,
                'amount', amount, 'legacy', is_legacy, 'note', notes) order by issued_at desc, number)
        from (select * from ex order by issued_at desc, number limit 500) y), '[]'),
    'legacy_count', (select count(*) from ex where is_legacy)
  )
$$;

create or replace function report_expenses_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select report_expenses_base_core(p_company, p_from, p_to) || jsonb_build_object('payroll', jsonb_build_object(
    'count', (select count(*) from payroll_entries p where p.company_id = p_company and p.kind = 'salary' and p.status = 'posted' and p.deleted_at is null
              and p.amount > 0 and p.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and p.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')),
    'amount', coalesce((select sum(p.amount) from payroll_entries p where p.company_id = p_company and p.kind = 'salary' and p.status = 'posted' and p.deleted_at is null
              and p.issued_at >= (p_from::timestamp at time zone 'Africa/Cairo') and p.issued_at < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')), 0)))
$$;


create index if not exists sales_invoice_lines_product_idx on sales_invoice_lines (product_id);
create index if not exists sales_return_lines_return_idx on sales_return_lines (return_id);
create index if not exists purchase_invoice_lines_invoice_idx on purchase_invoice_lines (invoice_id);
create index if not exists purchase_return_lines_return_idx on purchase_return_lines (return_id);
create index if not exists purchase_invoices_company_issued_idx on purchase_invoices (company_id, issued_at);
create index if not exists purchase_returns_company_issued_idx on purchase_returns (company_id, issued_at);
create index if not exists expenses_company_issued_idx on expenses (company_id, issued_at);
create index if not exists supplier_payments_company_issued_idx on supplier_payments (company_id, issued_at);
create index if not exists payroll_company_issued_idx on payroll_entries (company_id, issued_at);
create index if not exists audit_log_company_occurred_idx on audit_log (company_id, occurred_at);
