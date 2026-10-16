/** Shape of `migration-data/ospos-export-*.json` (format `ospos-browser-export/1`, skill ospos-migration reference.md §1). */
export interface OsposExport {
  meta: {
    format: string;
    exportedAt: string;
    salesSearchTotal: number;
    counts: Record<string, number>;
    errors: unknown[];
    saleLineColumns: { field: number; title: string }[];
    receivingLineColumns: { field: number; title: string }[];
  };
  items: {
    'items.item_id': string;
    item_number: string;
    name: string;
    category: string;
    company_name: string;
    cost_price: string;
    unit_price: string;
    quantity: string;
  }[];
  inventory_summary: {
    item_name: string;
    item_number: string;
    quantity: string;
    reorder_level: string;
    location_name: string;
    cost_price: string;
    unit_price: string;
  }[];
  customers: { person_id: string; list: Record<string, string>; form: Record<string, string> }[];
  suppliers: { person_id: string; list: Record<string, string>; form: Record<string, string> }[];
  employees: { person_id: string; first_name: string; last_name: string }[];
  expenses: {
    expense_id: string;
    date: string;
    supplier_name: string;
    amount: string;
    tax_amount: string;
    payment_type: string;
    category_name: string;
    description: string;
    supplier_tax_code?: string;
    created_by?: string;
  }[];
  sales: {
    id: string;
    type_code: string;
    sale_date: string;
    quantity: string;
    employee_name: string;
    customer_name: string;
    subtotal: string;
    tax: string;
    total: string;
    cost: string;
    profit: string;
    payment_type: string;
    comment: string;
  }[];
  sale_lines: Record<string, string[][]>;
  receivings: {
    id: string;
    receiving_date: string;
    quantity: string;
    employee_name: string;
    supplier_name: string;
    total: string;
    profit: string;
    payment_type: string;
    reference: string;
    comment: string;
  }[];
  receiving_lines: Record<string, string[][]>;
}

export type Row = Record<string, string | number | boolean | null | Record<string, unknown>>;

/** Import order matters: parents before children (foreign keys). */
export const TABLE_ORDER = [
  'companies',
  'branches',
  'warehouses',
  'workers',
  'expense_categories',
  'categories',
  'suppliers',
  'customers',
  'products',
  'barcodes',
  'openings',
  'stock_movements',
  'cash_movements',
  'sales_invoices',
  'sales_invoice_lines',
  'sales_returns',
  'sales_return_lines',
  'purchase_invoices',
  'purchase_invoice_lines',
  'purchase_returns',
  'purchase_return_lines',
  'payments',
  'expenses',
  'party_ledger',
] as const;
export type TableName = (typeof TABLE_ORDER)[number];

export interface Warning {
  code: string;
  count: number;
  note: string;
}

export interface TransformResult {
  tables: Record<TableName, Row[]>;
  warnings: Warning[];
  /** numbers the validation step compares against the database */
  stats: {
    companyId: string;
    mainWarehouseId: string;
    stockByProduct: Record<string, number>;
    salesTotalByMonth: Record<string, number>;
    unmatchedSaleLines: number;
    requisitions: string[];
  };
}
