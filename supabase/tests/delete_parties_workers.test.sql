begin;
select plan(7);

insert into customers (id, company_id, name) values ('a0000000-0000-7000-8000-00000000dc01', 'a0000000-0000-7000-8000-000000000001', 'عميل للحذف');
insert into suppliers (id, company_id, name) values ('a0000000-0000-7000-8000-00000000d501', 'a0000000-0000-7000-8000-000000000001', 'مورد للحذف');
insert into workers (id, company_id, name, role) values ('a0000000-0000-7000-8000-00000000d701', 'a0000000-0000-7000-8000-000000000001', 'عامل للحذف', 'cashier');

-- customer: 50.00 owed
insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'customer', 'a0000000-0000-7000-8000-00000000dc01', 5000, 'sales_invoice', gen_random_uuid(), now());
select throws_ok($$update customers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000dc01'$$,
  'P0001', 'E_VALIDATION:عليه رصيد، لازم يبقى صفر الأول', 'a customer with a balance cannot be deleted');
select lives_ok($$update customers set name = 'اسم جديد' where id = 'a0000000-0000-7000-8000-00000000dc01'$$,
  'other columns of a customer with a balance still change');
insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'customer', 'a0000000-0000-7000-8000-00000000dc01', -5000, 'customer_receipt', gen_random_uuid(), now());
select lives_ok($$update customers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000dc01'$$,
  'at balance 0 the customer is deleted');

-- supplier: we owe 30.00
insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'supplier', 'a0000000-0000-7000-8000-00000000d501', -3000, 'purchase_invoice', gen_random_uuid(), now());
select throws_ok($$update suppliers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000d501'$$,
  'P0001', 'E_VALIDATION:عليه رصيد، لازم يبقى صفر الأول', 'a supplier with a balance cannot be deleted');
insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'supplier', 'a0000000-0000-7000-8000-00000000d501', 3000, 'supplier_payment', gen_random_uuid(), now());
select lives_ok($$update suppliers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000d501'$$,
  'at balance 0 the supplier is deleted');

-- worker: an advance of 300.00 not yet taken by a salary
insert into payroll_entries (id, company_id, number, issued_at, employee_id, kind, month, amount) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-ADV-990001', now() - interval '2 days', 'a0000000-0000-7000-8000-00000000d701', 'advance', '2026-10', 30000);
select throws_ok($$update workers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000d701'$$,
  'P0001', 'E_VALIDATION:عليه سلف لسه ما اتخصمتش', 'a worker who owes an advance cannot be deleted');
insert into payroll_entries (id, company_id, number, issued_at, employee_id, kind, month, amount, net, carry_out) values
  (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', 'K1-SAL-990001', now() - interval '1 day', 'a0000000-0000-7000-8000-00000000d701', 'salary', '2026-10', 270000, 270000, 0);
select lives_ok($$update workers set deleted_at = now() where id = 'a0000000-0000-7000-8000-00000000d701'$$,
  'after a salary took the advance the worker is deleted');

select * from finish();
rollback;
