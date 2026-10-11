-- Expenses report: totals by category, by cash account and by day, and the list (the imported OpenSourcePOS expenses included).

create or replace function report_expenses_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with ex as (
    select e.id, e.number, e.issued_at, (e.issued_at at time zone 'Africa/Cairo')::date d, e.amount, e.is_legacy, e.notes,
           coalesce(c.name, '') category, a.name account
      from expenses e
      left join expense_categories c on c.id = e.category_id
      left join cash_accounts a on a.id = e.cash_account_id
     where e.company_id = p_company and e.status = 'posted' and e.deleted_at is null
       and (e.issued_at at time zone 'Africa/Cairo')::date between p_from and p_to
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

create or replace function report_expenses(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', true, 'data', report_expenses_core(report_guard(p_from, p_to), p_from, p_to), 'generated_at', now());
end $$;

revoke all on function report_expenses_core(uuid, date, date) from public, anon, authenticated;
revoke all on function report_expenses(date, date) from public, anon;
grant execute on function report_expenses(date, date) to authenticated;
