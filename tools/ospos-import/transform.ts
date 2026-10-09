// parse + match + transform: one pure function from the export to rows of the new schema (docs/DATABASE.md §4, §9).
// History rows are legacy (`is_legacy = true`) and produce NO ledger rows; only the stock opening writes a ledger.
import {
  cleanText,
  legacyId,
  mapPaymentLabel,
  mulDivRound,
  normalizeArabic,
  parseDate,
  parseDiscount,
  parseMoney,
  parseQty,
  parseSalePayments,
  type PaymentPart,
} from './parse.ts';
import {
  TABLE_ORDER,
  type OsposExport,
  type Row,
  type TableName,
  type TransformResult,
  type Warning,
} from './types.ts';

const SHOP_NAME = 'مركز حنفي للتلوين';
const SALE_KINDS: Record<string, 'invoice' | 'return'> = {
  'نقطة بيع': 'invoice',
  'كود الفواتير الرسمية': 'invoice',
  'كود عمليات المرتجع': 'return',
};
const PLACEHOLDER_SUPPLIER = 'مورد غير محدد (أرشيف قديم)';

export function transform(data: OsposExport): TransformResult {
  const tables = Object.fromEntries(TABLE_ORDER.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;
  const warn = new Map<string, Warning>();
  const note = (code: string, text: string): void => {
    const w = warn.get(code) ?? { code, count: 0, note: text };
    w.count += 1;
    warn.set(code, w);
  };
  const exportedAt = data.meta.exportedAt;

  const companyId = legacyId('company', 1);
  const common = (id: string, at: string = exportedAt) => ({
    id,
    company_id: companyId,
    device_id: null,
    created_by: null,
    created_at: at,
    updated_at: at,
    version: 1,
    deleted_at: null,
  });
  const push = (t: TableName, row: Row): void => void tables[t].push(row);

  // ---- structure -------------------------------------------------------------------------------------------------
  const branchId = legacyId('branch', 1);
  const mainWarehouseId = legacyId('warehouse', 1);
  push('companies', {
    ...common(companyId),
    name: SHOP_NAME,
    phone: null,
    address: null,
    tax_number: null,
    logo_path: null,
  });
  push('branches', { ...common(branchId), name: 'الفرع الرئيسي' });
  push('warehouses', {
    ...common(mainWarehouseId),
    branch_id: branchId,
    name: 'المخزن الرئيسي',
    kind: 'main',
    legacy_location_id: 1,
  });
  push('warehouses', {
    ...common(legacyId('warehouse', 'scrap')),
    branch_id: branchId,
    name: 'التالف',
    kind: 'scrap',
    legacy_location_id: null,
  });

  // ---- workers (names only, inactive, no PIN) --------------------------------------------------------------------
  const workerByName = new Map<string, string>();
  for (const e of data.employees) {
    const name = cleanText(`${e.first_name} ${e.last_name}`);
    const id = legacyId('employee', e.person_id);
    workerByName.set(normalizeArabic(name), id);
    push('workers', {
      ...common(id),
      name,
      role: 'cashier',
      pin_hash: null,
      pin_salt: null,
      photo_path: null,
      active: false,
      legacy_employee_id: Number(e.person_id),
    });
  }

  // ---- suppliers / customers -------------------------------------------------------------------------------------
  const supplierByName = new Map<string, string>();
  for (const s of data.suppliers) {
    const person = cleanText(`${s.list.first_name ?? ''} ${s.list.last_name ?? ''}`);
    const name = cleanText(s.list.company_name) || person;
    const id = legacyId('supplier', s.person_id);
    supplierByName.set(normalizeArabic(name), id);
    push('suppliers', {
      ...common(id),
      name,
      contact_name: person || null,
      phone: digits(s.list.phone_number),
      address: address(s.form),
      notes: cleanText(s.form.comments) || null,
      is_expense_supplier: cleanText(s.list.category) === '1',
      active: true,
      legacy_person_id: Number(s.person_id),
    });
  }
  const placeholderSupplier = legacyId('supplier', 'unknown');
  push('suppliers', {
    ...common(placeholderSupplier),
    name: PLACEHOLDER_SUPPLIER,
    contact_name: null,
    phone: null,
    address: null,
    notes: null,
    is_expense_supplier: false,
    active: false,
    legacy_person_id: null,
  });

  const customerByName = new Map<string, string>();
  for (const c of data.customers) {
    const name =
      cleanText(`${c.list.first_name ?? ''} ${c.list.last_name ?? ''}`) ||
      cleanText(c.form.company_name) ||
      'عميل';
    const id = legacyId('customer', c.person_id);
    customerByName.set(normalizeArabic(name), id);
    const discount = parseDiscount(
      c.form.discount_type === '1' ? `${c.form.discount ?? ''}` : `${c.form.discount ?? ''}%`,
    );
    push('customers', {
      ...common(id),
      name,
      phone: digits(c.list.phone_number),
      address: address(c.form),
      company: cleanText(c.form.company_name) || null,
      notes: cleanText(c.form.comments) || null,
      credit_limit: 0,
      default_discount_bp: discount?.kind === 'percentBp' ? discount.bp : 0,
      photo_path: null,
      active: true,
      legacy_person_id: Number(c.person_id),
    });
  }

  // ---- categories ------------------------------------------------------------------------------------------------
  const categoryId = new Map<string, string>();
  [...new Set(data.items.map((i) => cleanText(i.category)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ar'))
    .forEach((name, i) => {
      const id = legacyId('category', name);
      categoryId.set(name, id);
      push('categories', {
        ...common(id),
        parent_id: null,
        name,
        color_token: `cat-${(i % 8) + 1}`,
        icon: null,
        sort: i,
      });
    });

  // ---- products (+ barcodes, stock opening) ----------------------------------------------------------------------
  const inventoryByBarcode = new Map<string, OsposExport['inventory_summary'][number]>();
  const inventoryByName = new Map<string, OsposExport['inventory_summary'][number]>();
  for (const r of data.inventory_summary) {
    if (cleanText(r.item_number)) inventoryByBarcode.set(cleanText(r.item_number), r);
    inventoryByName.set(normalizeArabic(r.item_name), r);
  }
  const byBarcode = new Map<string, string>();
  const byName = new Map<string, string>();
  const byNormName = new Map<string, string>();
  const fractional = new Set<string>();
  const stockByProduct: Record<string, number> = {};
  const openingStockId = legacyId('opening', 'stock');
  const productRows: Row[] = [];

  for (const item of data.items) {
    const itemId = item['items.item_id'];
    const id = legacyId('item', itemId);
    const barcode = cleanText(item.item_number);
    if (barcode) byBarcode.set(barcode, id);
    byName.set(cleanText(item.name), id);
    byNormName.set(normalizeArabic(item.name), id);
    const inv =
      (barcode && inventoryByBarcode.get(barcode)) || inventoryByName.get(normalizeArabic(item.name));
    if (!inv)
      note(
        'NO_INVENTORY_ROW',
        'items without a row in the inventory summary (stock opening = items.quantity)',
      );
    const qty = parseQty(inv?.quantity ?? item.quantity) ?? 0;
    if (qty % 1000 !== 0) fractional.add(id);
    stockByProduct[id] = qty;
    if (!barcode) note('ITEM_NO_BARCODE', 'items without a barcode');
    if (!cleanText(item.unit_price) || parseMoney(item.unit_price) === 0)
      note('ITEM_NO_PRICE', 'items with a zero or missing price');
    productRows.push({
      ...common(id),
      sku: barcode || null,
      name: cleanText(item.name),
      category_id: categoryId.get(cleanText(item.category)) ?? null,
      type: 'stock',
      base_unit_name: 'قطعة',
      qty_decimals: 0,
      price: parseMoney(item.unit_price) ?? 0,
      unit_cost: parseMoney(item.cost_price) ?? 0,
      reorder_level: parseQty(inv?.reorder_level ?? '0') ?? 0,
      default_supplier_id: supplierByName.get(normalizeArabic(item.company_name)) ?? null,
      image_path: null,
      extra_fields: null,
      active: true,
      legacy_item_id: Number(itemId),
    });
    if (barcode)
      push('barcodes', {
        ...common(legacyId('barcode', `${itemId}:${barcode}`)),
        product_id: id,
        product_unit_id: null,
        code: barcode,
      });
  }

  // ---- matching helpers ------------------------------------------------------------------------------------------
  const matchProduct = (barcode: string, name: string): string | null =>
    (cleanText(barcode) && byBarcode.get(cleanText(barcode))) ||
    byName.get(cleanText(name)) ||
    byNormName.get(normalizeArabic(name)) ||
    null;
  const matchSupplier = (name: string): string | null => supplierByName.get(normalizeArabic(name)) ?? null;

  // ---- sales -----------------------------------------------------------------------------------------------------
  const salesTotalByMonth: Record<string, number> = {};
  let unmatchedSaleLines = 0;
  for (const sale of data.sales) {
    const kind = SALE_KINDS[cleanText(sale.type_code)];
    if (!kind) {
      note('UNKNOWN_SALE_TYPE', `sales with an unknown type_code (skipped): ${cleanText(sale.type_code)}`);
      continue;
    }
    const issuedAt = parseDate(sale.sale_date);
    const total = parseMoney(sale.total);
    if (!issuedAt || total === null) {
      note('BAD_SALE_ROW', 'sales with an unreadable date or total (skipped)');
      continue;
    }
    const isReturn = kind === 'return';
    const id = legacyId(isReturn ? 'return' : 'sale', sale.id);
    const number = `LG-${isReturn ? 'RET' : 'INV'}-${String(sale.id).padStart(6, '0')}`;
    const customerId = customerByName.get(normalizeArabic(sale.customer_name)) ?? null;
    if (cleanText(sale.customer_name) && !customerId)
      note('SALE_CUSTOMER_UNMATCHED', 'sales whose customer name matches no customer (kept as text)');
    const doc = {
      ...common(id, issuedAt),
      number,
      issued_at: issuedAt,
      worker_id: workerByName.get(normalizeArabic(sale.employee_name)) ?? null,
      shift_id: null,
      status: 'posted',
      voided_by: null,
      notes: cleanText(sale.comment) || null,
      is_legacy: true,
      legacy: {
        ospos_id: Number(sale.id),
        type_code: cleanText(sale.type_code),
        payment_type: cleanText(sale.payment_type),
        customer_name: cleanText(sale.customer_name) || null,
        employee_name: cleanText(sale.employee_name) || null,
        cost: parseMoney(sale.cost),
        profit: parseMoney(sale.profit),
      },
    };
    const month = issuedAt.slice(0, 7);
    salesTotalByMonth[month] = (salesTotalByMonth[month] ?? 0) + (isReturn ? -Math.abs(total) : total);

    const lines = data.sale_lines[sale.id] ?? [];
    lines.forEach((l, i) => {
      const [
        name = '',
        ,
        barcode = '',
        ,
        qtyText = '',
        subText = '',
        taxText = '',
        ,
        costText = '',
        ,
        discText = '',
      ] = l;
      const qty = Math.abs(parseQty(qtyText) ?? 0);
      const subtotal = Math.abs(parseMoney(subText) ?? 0);
      const cost = Math.abs(parseMoney(costText) ?? 0);
      const productId = matchProduct(barcode, name);
      if (!productId) {
        unmatchedSaleLines += 1;
      }
      const disc = parseDiscount(discText);
      const discountNote = disc?.kind === 'percentBp' ? `خصم ${disc.bp / 100}%` : null;
      const row: Row = {
        ...common(legacyId(isReturn ? 'return-line' : 'sale-line', `${sale.id}:${i}`), issuedAt),
        line_no: i + 1,
        product_id: productId,
        is_legacy: true,
        warehouse_id: mainWarehouseId,
      };
      if (isReturn) {
        const returnLine = { ...row };
        delete returnLine.line_no; // sales_return_lines has no line_no column
        push('sales_return_lines', {
          ...returnLine,
          return_id: id,
          original_line_id: null,
          qty,
          unit_refund: qty ? mulDivRound(subtotal, 1000, qty) : 0,
          net_amount: subtotal,
          unit_cost: qty ? mulDivRound(cost, 1000, qty) : 0,
          condition: 'good',
        });
      } else {
        push('sales_invoice_lines', {
          ...row,
          invoice_id: id,
          product_unit_id: null,
          unit_factor: 1000,
          qty,
          unit_price: qty ? mulDivRound(subtotal, 1000, qty) : 0,
          line_discount: disc?.kind === 'fixed' ? disc.piasters : 0,
          alloc_discount: 0,
          tax_amount: Math.abs(parseMoney(taxText) ?? 0),
          net_amount: subtotal,
          unit_cost: qty ? mulDivRound(cost, 1000, qty) : 0,
          legacy_text: [productId ? null : cleanText(name), discountNote].filter(Boolean).join(' | ') || null,
        });
      }
      if (productId && qty % 1000 !== 0) fractional.add(productId);
    });

    let payments: PaymentPart[] = parseSalePayments(sale.payment_type);
    if (payments.length === 0 && total !== 0) {
      note('SALE_EMPTY_PAYMENT', 'sales with no payment text (stored as cash)');
      payments = [{ label: '', method: 'cash', known: true, amount: total }];
    }
    for (const [pi, p] of payments.entries()) {
      if (!p.known)
        note('UNKNOWN_PAYMENT_LABEL', `payment labels outside the map (stored as other): ${p.label}`);
      if (p.amount === 0) continue;
      push('payments', {
        ...common(legacyId('payment', `${isReturn ? 'return' : 'sale'}:${sale.id}:${pi}`), issuedAt),
        document_type: isReturn ? 'sales_return' : 'sales_invoice',
        document_id: id,
        method: p.method,
        amount: Math.abs(p.amount),
        reference: null,
        cash_account_id: null,
        is_legacy: true,
      });
    }

    if (isReturn) {
      const credit = payments.some((p) => p.method === 'credit');
      push('sales_returns', {
        ...doc,
        original_invoice_id: null,
        customer_id: customerId,
        total: Math.abs(total),
        refund_method: credit ? 'credit' : 'cash',
        reason: cleanText(sale.comment) || null,
        approved_by: null,
      });
    } else {
      // OSPOS rounds cash (75.25 sold, 75.30 paid): the difference lives in cash_rounding, payments keep what was paid
      const paid = payments.reduce((a, p) => a + p.amount, 0);
      const cashRounding = payments.length ? paid - total : 0;
      if (Math.abs(cashRounding) > 5)
        note(
          'SALE_PAYMENT_MISMATCH',
          'sales whose payments differ from the total by more than 0.05 (difference kept in cash_rounding)',
        );
      push('sales_invoices', {
        ...doc,
        customer_id: customerId,
        warehouse_id: mainWarehouseId,
        subtotal: parseMoney(sale.subtotal) ?? 0,
        line_discount_total: 0,
        invoice_discount: 0,
        tax_total: parseMoney(sale.tax) ?? 0,
        cash_rounding: cashRounding,
        total,
        cash_tendered: 0,
        change_due: 0,
      });
    }
  }

  // ---- receivings ------------------------------------------------------------------------------------------------
  const requisitions: string[] = [];
  for (const r of data.receivings) {
    const issuedAt = parseDate(r.receiving_date);
    const total = parseMoney(r.total);
    if (!issuedAt || total === null) {
      note('BAD_RECEIVING_ROW', 'receivings with an unreadable date or total (skipped)');
      continue;
    }
    if (total === 0) {
      requisitions.push(r.id);
      continue;
    }
    const isReturn = total < 0;
    const id = legacyId(isReturn ? 'purchase-return' : 'purchase', r.id);
    const supplierId = matchSupplier(r.supplier_name) ?? placeholderSupplier;
    if (supplierId === placeholderSupplier)
      note(
        'RECEIVING_SUPPLIER_UNMATCHED',
        'receivings without a known supplier (linked to the archive placeholder supplier)',
      );
    const doc = {
      ...common(id, issuedAt),
      number: `LG-${isReturn ? 'PRT' : 'PUR'}-${String(r.id).padStart(6, '0')}`,
      issued_at: issuedAt,
      worker_id: workerByName.get(normalizeArabic(r.employee_name)) ?? null,
      shift_id: null,
      status: 'posted',
      voided_by: null,
      notes: cleanText(r.comment) || null,
      is_legacy: true,
      legacy: {
        ospos_id: Number(r.id),
        supplier_name: cleanText(r.supplier_name) || null,
        employee_name: cleanText(r.employee_name) || null,
        payment_type: cleanText(r.payment_type),
      },
      supplier_id: supplierId,
      warehouse_id: mainWarehouseId,
      subtotal: Math.abs(total),
      discount: 0,
      total: Math.abs(total),
    };
    (data.receiving_lines[r.id] ?? []).forEach((l, i) => {
      const [barcode = '', name = '', , qtyText = '', totalText = ''] = l;
      const qty = Math.abs(parseQty(qtyText) ?? 0);
      const lineTotal = Math.abs(parseMoney(totalText) ?? 0);
      const productId = matchProduct(barcode, name);
      if (productId && qty % 1000 !== 0) fractional.add(productId);
      push(isReturn ? 'purchase_return_lines' : 'purchase_invoice_lines', {
        ...common(legacyId(isReturn ? 'purchase-return-line' : 'purchase-line', `${r.id}:${i}`), issuedAt),
        [isReturn ? 'return_id' : 'invoice_id']: id,
        line_no: i + 1,
        product_id: productId,
        product_unit_id: null,
        unit_factor: 1000,
        qty,
        unit_cost: qty ? mulDivRound(lineTotal, 1000, qty) : 0,
        discount: 0,
        net_amount: lineTotal,
        legacy_text: productId ? null : cleanText(name),
        is_legacy: true,
      });
    });
    const pay = mapPaymentLabel(cleanText(r.payment_type) || 'نقدى');
    if (!pay.known)
      note(
        'UNKNOWN_PAYMENT_LABEL',
        `payment labels outside the map (stored as other): ${cleanText(r.payment_type)}`,
      );
    if (!cleanText(r.payment_type))
      note('RECEIVING_EMPTY_PAYMENT', 'receivings with no payment label (stored as cash)');
    push('payments', {
      ...common(legacyId('payment', `purchase:${r.id}`), issuedAt),
      document_type: isReturn ? 'purchase_return' : 'purchase_invoice',
      document_id: id,
      method: pay.method,
      amount: Math.abs(total),
      reference: null,
      cash_account_id: null,
      is_legacy: true,
    });
    push(isReturn ? 'purchase_returns' : 'purchase_invoices', {
      ...doc,
      ...(isReturn ? { original_invoice_id: null } : { supplier_ref: cleanText(r.reference) || null }),
    });
  }
  if (requisitions.length)
    note('REQUISITIONS_SKIPPED', 'receivings with zero total (requisitions): not imported as purchases');

  // ---- expenses --------------------------------------------------------------------------------------------------
  const expenseCategoryId = new Map<string, string>();
  for (const name of [...new Set(data.expenses.map((e) => cleanText(e.category_name)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'ar'),
  )) {
    const id = legacyId('expense-category', name);
    expenseCategoryId.set(name, id);
    push('expense_categories', { ...common(id), name, icon: null });
  }
  const uncategorized = legacyId('expense-category', '__none__');
  for (const e of data.expenses) {
    const issuedAt = parseDate(e.date);
    const amount = parseMoney(e.amount);
    if (!issuedAt || amount === null || amount <= 0) {
      note('EXPENSE_SKIPPED', 'expenses with a zero, negative or unreadable amount/date (skipped)');
      continue;
    }
    let categoryOf = expenseCategoryId.get(cleanText(e.category_name));
    if (!categoryOf) {
      categoryOf = uncategorized;
      if (!expenseCategoryId.has('__none__')) {
        expenseCategoryId.set('__none__', uncategorized);
        push('expense_categories', { ...common(uncategorized), name: 'بدون تصنيف', icon: null });
      }
    }
    push('expenses', {
      ...common(legacyId('expense', e.expense_id), issuedAt),
      number: `LG-EXP-${String(e.expense_id).padStart(6, '0')}`,
      issued_at: issuedAt,
      worker_id: workerByName.get(normalizeArabic(e.created_by ?? '')) ?? null,
      shift_id: null,
      status: 'posted',
      voided_by: null,
      notes: cleanText(e.description) || null,
      is_legacy: true,
      legacy: {
        ospos_id: Number(e.expense_id),
        payment_type: cleanText(e.payment_type),
        tax_amount: parseMoney(e.tax_amount),
        supplier_tax_code: cleanText(e.supplier_tax_code) || null,
      },
      category_id: categoryOf,
      amount,
      cash_account_id: null,
      supplier_id: matchSupplier(e.supplier_name),
    });
  }

  // ---- stock opening + final product rows ------------------------------------------------------------------------
  for (const row of productRows) row.qty_decimals = fractional.has(String(row.id)) ? 3 : 0;
  tables.products.push(...productRows);
  push('openings', {
    ...common(openingStockId),
    number: 'LG-OPN-000001',
    issued_at: exportedAt,
    worker_id: null,
    shift_id: null,
    status: 'posted',
    voided_by: null,
    notes: 'رصيد افتتاحي للمخزون من OpenSourcePOS',
    is_legacy: false,
    legacy: null,
    kind: 'stock',
    approved_by: null,
  });
  for (const row of productRows) {
    const qty = stockByProduct[String(row.id)] ?? 0;
    if (qty === 0) continue;
    push('stock_movements', {
      ...common(legacyId('opening-stock', String(row.legacy_item_id))),
      product_id: String(row.id),
      warehouse_id: mainWarehouseId,
      qty,
      unit_cost: Number(row.unit_cost),
      doc_type: 'opening',
      doc_id: openingStockId,
      line_id: null,
      occurred_at: exportedAt,
    });
  }
  if (unmatchedSaleLines)
    note('SALE_LINES_UNMATCHED', 'sale lines whose product is not in the current item list (kept as text)');
  warn.get('SALE_LINES_UNMATCHED')!.count = unmatchedSaleLines;

  return {
    tables,
    warnings: [...warn.values()].sort((a, b) => b.count - a.count),
    stats: {
      companyId,
      mainWarehouseId,
      stockByProduct,
      salesTotalByMonth,
      unmatchedSaleLines,
      requisitions,
    },
  };
}

function digits(s: string | undefined): string | null {
  const d = String(s ?? '').replace(/\D/g, '');
  return d || null;
}

function address(form: Record<string, string>): string | null {
  return [form.address_1, form.address_2, form.city].map(cleanText).filter(Boolean).join('، ') || null;
}
