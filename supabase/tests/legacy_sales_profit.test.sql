begin;
select plan(3);

insert into legacy_sales (company_id, id, kind, day, total, cash) values
  ('a0000000-0000-7000-8000-000000000001', 770001, 0, '2021-05-01', 10000, 10000),
  ('a0000000-0000-7000-8000-000000000001', 770002, 1, '2021-05-02', 3000, 3000),
  ('a0000000-0000-7000-8000-000000000001', 770003, 0, '2021-05-03', 500, 500);
insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost) values
  (770001, 1, null, 'x', 2000, 6000, 4000),
  (770001, 2, null, 'y', 1000, 4000, 1000),
  (770002, 1, null, 'x', 1000, 3000, 2000);

create function pg_temp.profit(p_id int) returns bigint language sql as $$
  select (r ->> 'profit')::bigint
    from jsonb_array_elements(search_legacy_sales_core('a0000000-0000-7000-8000-000000000001', '2021-05-01', '2021-05-03',
           null, null, null, null, null, null, null, 0) -> 'rows') r
   where (r ->> 'id')::int = p_id
$$;

select is(pg_temp.profit(770001), 5000::bigint, 'a sale: net minus cost over its lines');
select is(pg_temp.profit(770002), -1000::bigint, 'a return takes its profit back (negative)');
select is(pg_temp.profit(770003), 0::bigint, 'a sale without lines has profit 0');

select * from finish();
rollback;
