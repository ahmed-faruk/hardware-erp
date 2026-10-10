-- AUD-02 / AUD-03: the exceptions report also lists what the audit log recorded (price and discount overrides,
-- negative-stock sales, wrong PINs, setting changes, removed cart lines, suspicious device clocks).
create or replace function report_audit_extras_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (
    select * from audit_log
     where company_id = p_company and (occurred_at at time zone 'Africa/Cairo')::date between p_from and p_to
  )
  select jsonb_build_object(
    'negative_stock', (select count(*) from a where action = 'negative_stock_sale'),
    'price_overrides', (select count(*) from a where action = 'price_override'),
    'discount_overrides', (select count(*) from a where action = 'discount_over_limit'),
    'pin_failures', (select count(*) from a where action in ('pin_failed', 'pin_locked')),
    'cart_removals', (select count(*) from a where action = 'cart_line_removed'),
    'settings_changes', coalesce((select jsonb_agg(jsonb_build_object('key', a.after ->> 'key', 'at', a.occurred_at, 'worker', coalesce(w.name, '—')) order by a.occurred_at)
      from a left join workers w on w.id = a.worker_id where a.action = 'setting_changed'), '[]'),
    'clock_warnings', coalesce((select jsonb_agg(jsonb_build_object('device', coalesce(d.name, '—'), 'at', a.occurred_at, 'skew_ms', (a.after ->> 'skewMs')::bigint) order by a.occurred_at)
      from a left join devices d on d.id = a.entity_id where a.action = 'clock_suspicious'), '[]')
  )
$$;
revoke all on function report_audit_extras_core(uuid, date, date) from public, anon, authenticated;

create or replace function report_exceptions_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select (jsonb_build_object(
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
  )) || report_audit_extras_core(p_company, p_from, p_to)
$$;
