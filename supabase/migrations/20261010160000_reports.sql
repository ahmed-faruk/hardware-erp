-- Phase 8 PR B: manager reports computed on the server (they include the whole OpenSourcePOS history).
-- Each report is a `_core(company, ...)` function (also used by the import validator with the service role)
-- and a thin RPC that only manager devices may call.

create index sales_invoices_company_issued_idx on sales_invoices (company_id, issued_at);
create index sales_returns_company_issued_idx on sales_returns (company_id, issued_at);

create or replace function report_sales_summary_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with inv as (
    select (issued_at at time zone 'Africa/Cairo')::date d, id, worker_id, total, is_legacy
      from sales_invoices
     where company_id = p_company and status = 'posted' and deleted_at is null
       and (issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), ret as (
    select (issued_at at time zone 'Africa/Cairo')::date d, total
      from sales_returns
     where company_id = p_company and status = 'posted' and deleted_at is null
       and (issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
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

-- profit = what lines sold for (after their share of the invoice discount) − cost of the goods; returns take both back.
-- unit_cost is per base unit, qty is in the sold unit: cost = unit_cost x qty x factor / 1,000,000.
create or replace function report_profit_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with sold as (
    select (i.issued_at at time zone 'Africa/Cairo')::date d,
           (l.net_amount - l.alloc_discount) revenue,
           round(l.unit_cost::numeric * l.qty * l.unit_factor / 1000000)::bigint cost
      from sales_invoices i join sales_invoice_lines l on l.invoice_id = i.id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
       and (i.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ), back as (
    select (r.issued_at at time zone 'Africa/Cairo')::date d,
           -l.net_amount revenue,
           -round(l.unit_cost::numeric * l.qty * coalesce(o.unit_factor, 1000) / 1000000)::bigint cost
      from sales_returns r join sales_return_lines l on l.return_id = r.id
      left join sales_invoice_lines o on o.id = l.original_line_id
     where r.company_id = p_company and r.status = 'posted' and r.deleted_at is null
       and (r.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
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
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'voids', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'at', v.issued_at, 'reason', v.reason, 'worker', coalesce(w.name, '—')) order by v.issued_at)
      from voids v left join workers w on w.id = v.worker_id
     where v.company_id = p_company and (v.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'),
    'reprints', (select count(*) from audit_log a where a.company_id = p_company and a.action = 'invoice_reprinted'
                  and (a.occurred_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'no_sales', coalesce((select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by a.occurred_at)
      from audit_log a left join workers w on w.id = a.worker_id left join workers m on m.id = a.approved_by
     where a.company_id = p_company and a.action = 'no_sale' and (a.occurred_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'),
    'discounts', (select jsonb_build_object('lines', count(*), 'amount', coalesce(sum(l.line_discount + l.alloc_discount), 0))
      from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id
     where i.company_id = p_company and i.status = 'posted' and not i.is_legacy and (l.line_discount + l.alloc_discount) > 0
       and (i.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'stock_adjustments', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'at', s.issued_at, 'reason', s.reason_code, 'approved_by', coalesce(m.name, '—')) order by s.issued_at)
      from stock_adjustments s left join workers m on m.id = s.approved_by
     where s.company_id = p_company and (s.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]'),
    'shift_variances', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'variance', s.variance, 'worker', coalesce(w.name, '—'), 'approved_by', coalesce(m.name, '—')) order by s.closed_at)
      from shifts s left join workers w on w.id = s.worker_id left join workers m on m.id = s.approved_by
     where s.company_id = p_company and s.status = 'closed' and s.variance <> 0
       and (s.closed_at at time zone 'Africa/Cairo')::date between p_from and p_to), '[]')
  )
$$;

create or replace function report_devices_core(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', d.name, 'prefix', d.prefix, 'kind', d.kind, 'last_seen_at', d.last_seen_at, 'app_version', d.app_version,
    'revoked', d.revoked_at is not null,
    'open_shift', exists (select 1 from shifts s where s.device_id = d.id and s.status = 'open'),
    'errors_24h', (select count(*) from client_errors e where e.device_id = d.id and e.occurred_at > now() - interval '24 hours')
  ) order by d.name), '[]') from devices d where d.company_id = p_company
$$;

revoke all on function report_sales_summary_core(uuid, date, date), report_profit_core(uuid, date, date),
  report_exceptions_core(uuid, date, date), report_devices_core(uuid) from public, anon, authenticated;

-- the RPCs: manager devices only, a bounded period
create or replace function report_guard(p_from date, p_to date) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'E_VALIDATION:فترة غير صالحة';
  end if;
  return current_company();
end $$;

create or replace function report_sales_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_sales_summary_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;
create or replace function report_profit(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_profit_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;
create or replace function report_exceptions(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_exceptions_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;
create or replace function report_devices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager_device() then
    raise exception 'E_FORBIDDEN:للمدير فقط';
  end if;
  return jsonb_build_object('ok', true, 'data', report_devices_core(current_company()), 'generated_at', now());
end $$;

revoke all on function report_guard(date, date), report_sales_summary(date, date), report_profit(date, date),
  report_exceptions(date, date), report_devices() from public, anon;
grant execute on function report_sales_summary(date, date), report_profit(date, date), report_exceptions(date, date), report_devices() to authenticated;
