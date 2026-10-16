-- «الخزنة»: the shop has one box, so cash now is every cash movement of the company (no list of accounts).

create or replace function report_safe_core(p_company uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select (p_from::timestamp at time zone 'Africa/Cairo') lo, ((p_to + 1)::timestamp at time zone 'Africa/Cairo') hi
  ), cashmv as (
    select case m.doc_type
             when 'sales_invoice' then 'cash_sales' when 'customer_receipt' then 'cash_receipts'
             when 'purchase_return' then 'cash_purchase_returns' when 'opening' then 'opening'
             when 'sales_return' then 'cash_sales_returns' when 'purchase_invoice' then 'cash_purchases'
             when 'supplier_payment' then 'cash_supplier_payments' when 'expense' then 'expenses' when 'payroll' then 'payroll'
             when 'cash_adjustment' then 'cash_adjustments' when 'void' then 'voids' end k,
           case when m.doc_type in ('sales_invoice', 'customer_receipt', 'purchase_return', 'opening') then 'in'
                when m.doc_type in ('sales_return', 'purchase_invoice', 'supplier_payment', 'expense', 'payroll') then 'out'
                else 'adjust' end dir,
           m.amount
      from cash_movements m, b
     where m.company_id = p_company and m.deleted_at is null and m.occurred_at >= b.lo and m.occurred_at < b.hi
       and m.doc_type in ('sales_invoice', 'customer_receipt', 'purchase_return', 'opening', 'sales_return', 'purchase_invoice',
                          'supplier_payment', 'expense', 'payroll', 'cash_adjustment', 'void')
  ), lines0 as (
    -- cash: the ledger (money out is stored negative; out lines are shown positive)
    select k, dir, case when dir = 'out' then -amount else amount end amount from cashmv
    union all
    -- non-cash methods of posted sales and purchase invoices
    select case p.method when 'card' then 'card_sales' when 'instapay' then 'instapay_sales' when 'wallet' then 'wallet_sales' else 'other_sales' end, 'in', p.amount
      from payments p join sales_invoices i on i.id = p.document_id, b
     where p.document_type = 'sales_invoice' and p.company_id = p_company and p.deleted_at is null and p.method in ('card', 'instapay', 'wallet', 'other')
       and i.status = 'posted' and i.deleted_at is null and i.issued_at >= b.lo and i.issued_at < b.hi
    union all
    select 'noncash_receipts', 'in', r.amount
      from customer_receipts r, b
     where r.company_id = p_company and r.deleted_at is null and r.status = 'posted' and r.method in ('card', 'instapay', 'wallet', 'other')
       and r.issued_at >= b.lo and r.issued_at < b.hi
    union all
    select 'noncash_purchases', 'out', p.amount
      from payments p join purchase_invoices i on i.id = p.document_id, b
     where p.document_type = 'purchase_invoice' and p.company_id = p_company and p.deleted_at is null and p.method in ('card', 'instapay', 'wallet', 'other')
       and i.status = 'posted' and i.deleted_at is null and i.issued_at >= b.lo and i.issued_at < b.hi
    union all
    select 'noncash_supplier_payments', 'out', s.amount
      from supplier_payments s, b
     where s.company_id = p_company and s.deleted_at is null and s.status = 'posted' and s.method in ('card', 'instapay', 'wallet', 'other')
       and s.issued_at >= b.lo and s.issued_at < b.hi
    union all
    -- the old system
    select 'cash_sales', 'in', sum(cash) from legacy_sales where company_id = p_company and kind = 0 and day between p_from and p_to
    union all select 'card_sales', 'in', sum(card) from legacy_sales where company_id = p_company and kind = 0 and day between p_from and p_to
    union all select 'other_sales', 'in', sum(other) from legacy_sales where company_id = p_company and kind = 0 and day between p_from and p_to
    union all select 'cash_sales_returns', 'out', sum(cash + card + other) from legacy_sales where company_id = p_company and kind = 1 and day between p_from and p_to
    union all select 'cash_purchases', 'out', sum(cash + other) from legacy_purchases where company_id = p_company and kind = 0 and day between p_from and p_to
    union all select 'cash_purchase_returns', 'in', sum(cash + other) from legacy_purchases where company_id = p_company and kind = 1 and day between p_from and p_to
  ), lines as (
    select k, dir, sum(amount)::bigint amount from lines0 where amount is not null group by k, dir having sum(amount) <> 0
  ), owner as (
    select coalesce(sum(p.amount), 0) a from payments p join purchase_invoices i on i.id = p.document_id, b
     where p.document_type = 'purchase_invoice' and p.company_id = p_company and p.deleted_at is null and p.method = 'owner'
       and i.status = 'posted' and i.deleted_at is null and i.issued_at >= b.lo and i.issued_at < b.hi
  ), owner2 as (
    select coalesce(sum(s.amount), 0) a from supplier_payments s, b
     where s.company_id = p_company and s.deleted_at is null and s.status = 'posted' and s.method = 'owner' and s.issued_at >= b.lo and s.issued_at < b.hi
  ), accts as (
    -- the shop has one box: every cash movement of the company counts, whatever account it sits on
    select coalesce(sum(m.amount), 0)::bigint total from cash_movements m where m.company_id = p_company and m.deleted_at is null
  ), today as (
    select (now() at time zone 'Africa/Cairo')::date d
  ), rets as (
    select count(*)::int c, coalesce(sum(total), 0)::bigint t from sales_returns r, today
     where r.company_id = p_company and r.deleted_at is null and r.status = 'posted' and (r.issued_at at time zone 'Africa/Cairo')::date = today.d
  ), vds as (
    select count(*)::int c, coalesce(sum(i.total), 0)::bigint t from voids v join sales_invoices i on i.id = v.target_id, today
     where v.company_id = p_company and v.deleted_at is null and v.target_type = 'sales_invoice' and (v.issued_at at time zone 'Africa/Cairo')::date = today.d
  ), tot as (
    select coalesce(sum(amount) filter (where dir = 'in'), 0)::bigint tin, coalesce(sum(amount) filter (where dir = 'out'), 0)::bigint tout,
           coalesce(sum(amount) filter (where dir = 'adjust'), 0)::bigint tadj from lines
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'in', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'amount', amount) order by amount desc) from lines where dir = 'in'), '[]'),
    'out', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'amount', amount) order by amount desc) from lines where dir = 'out'), '[]'),
    'adjust', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'amount', amount) order by k) from lines where dir = 'adjust'), '[]'),
    'total_in', (select tin from tot), 'total_out', (select tout from tot), 'adjust_total', (select tadj from tot),
    'net', (select tin - tout + tadj from tot),
    'owner_paid', (select a from owner) + (select a from owner2),
    'legacy_count', (select count(*) from legacy_sales where company_id = p_company and day between p_from and p_to)
                  + (select count(*) from legacy_purchases where company_id = p_company and day between p_from and p_to),
    'cash_now', jsonb_build_object('total', (select total from accts)),
    'returns_today', jsonb_build_object('returns_count', (select c from rets), 'returns_total', (select t from rets),
      'voided_count', (select c from vds), 'voided_total', (select t from vds), 'today_total', (select t from rets) + (select t from vds))
  )
$$;

