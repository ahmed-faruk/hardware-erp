import Dexie, { type Table } from 'dexie';

import type * as T from './types';

export const SCHEMA_VERSION = 2;

/** Dexie names (camelCase) -> server table names (snake_case). */
export const SERVER_TABLE: Record<string, string> = {
  companies: 'companies',
  branches: 'branches',
  warehouses: 'warehouses',
  devices: 'devices',
  workers: 'workers',
  settings: 'settings',
  cashAccounts: 'cash_accounts',
  expenseCategories: 'expense_categories',
  categories: 'categories',
  products: 'products',
  productUnits: 'product_units',
  barcodes: 'barcodes',
  customers: 'customers',
  suppliers: 'suppliers',
  shifts: 'shifts',
  salesInvoices: 'sales_invoices',
  salesInvoiceLines: 'sales_invoice_lines',
  salesReturns: 'sales_returns',
  salesReturnLines: 'sales_return_lines',
  purchaseInvoices: 'purchase_invoices',
  purchaseInvoiceLines: 'purchase_invoice_lines',
  purchaseReturns: 'purchase_returns',
  purchaseReturnLines: 'purchase_return_lines',
  customerReceipts: 'customer_receipts',
  supplierPayments: 'supplier_payments',
  stockAdjustments: 'stock_adjustments',
  stockAdjustmentLines: 'stock_adjustment_lines',
  expenses: 'expenses',
  cashTransfers: 'cash_transfers',
  voids: 'voids',
  openings: 'openings',
  payments: 'payments',
  stockMovements: 'stock_movements',
  partyLedger: 'party_ledger',
  cashMovements: 'cash_movements',
  auditLog: 'audit_log',
  clientErrors: 'client_errors',
};
export const LOCAL_TABLE: Record<string, string> = Object.fromEntries(
  Object.entries(SERVER_TABLE).map(([l, s]) => [s, l]),
);

export class HanafyDB extends Dexie {
  companies!: Table<T.Company, string>;
  branches!: Table<T.Branch, string>;
  warehouses!: Table<T.Warehouse, string>;
  devices!: Table<T.Device, string>;
  workers!: Table<T.Worker, string>;
  settings!: Table<T.Setting, string>;
  cashAccounts!: Table<T.CashAccount, string>;
  expenseCategories!: Table<T.ExpenseCategory, string>;
  categories!: Table<T.Category, string>;
  products!: Table<T.Product, string>;
  productUnits!: Table<T.ProductUnit, string>;
  barcodes!: Table<T.Barcode, string>;
  customers!: Table<T.Customer, string>;
  suppliers!: Table<T.Supplier, string>;
  shifts!: Table<T.Shift, string>;
  salesInvoices!: Table<T.SalesInvoice, string>;
  salesInvoiceLines!: Table<T.SalesInvoiceLine, string>;
  salesReturns!: Table<T.DocRow, string>;
  salesReturnLines!: Table<T.LooseRow, string>;
  purchaseInvoices!: Table<T.DocRow, string>;
  purchaseInvoiceLines!: Table<T.LooseRow, string>;
  purchaseReturns!: Table<T.DocRow, string>;
  purchaseReturnLines!: Table<T.LooseRow, string>;
  customerReceipts!: Table<T.DocRow, string>;
  supplierPayments!: Table<T.DocRow, string>;
  stockAdjustments!: Table<T.DocRow, string>;
  stockAdjustmentLines!: Table<T.LooseRow, string>;
  expenses!: Table<T.DocRow, string>;
  cashTransfers!: Table<T.DocRow, string>;
  voids!: Table<T.DocRow, string>;
  openings!: Table<T.DocRow, string>;
  payments!: Table<T.Payment, string>;
  stockMovements!: Table<T.StockMovement, string>;
  partyLedger!: Table<T.PartyLedgerRow, string>;
  cashMovements!: Table<T.CashMovement, string>;
  auditLog!: Table<T.AuditRow, string>;
  clientErrors!: Table<T.LooseRow, string>;
  // local-only stores (docs/DATABASE.md §4.7)
  outbox!: Table<T.OutboxRow, number>;
  syncState!: Table<T.SyncStateRow, string>;
  numberSequences!: Table<T.NumberSequence, string>;
  heldCarts!: Table<T.HeldCart, string>;
  stockBalances!: Table<T.StockBalance, [string, string]>;
  partyBalances!: Table<T.PartyBalance, [string, string]>;
  deviceSettings!: Table<T.KeyValue, string>;
  searchIndex!: Table<T.SearchToken, string>;

  constructor(name = 'HanafyPOS') {
    super(name);
    // never edit this block after release: add db.version(2) with .upgrade() instead (skill offline-sync-engine §8)
    this.version(1).stores({
      companies: 'id',
      branches: 'id',
      warehouses: 'id',
      devices: 'id',
      workers: 'id, active',
      settings: 'id, &key',
      cashAccounts: 'id',
      expenseCategories: 'id',
      categories: 'id, parentId',
      products: 'id, sku, categoryId, updatedAt',
      productUnits: 'id, productId',
      barcodes: 'id, code, productId',
      customers: 'id, phone',
      suppliers: 'id',
      shifts: 'id, &number, status, workerId',
      salesInvoices: 'id, &number, customerId, shiftId, issuedAt',
      salesInvoiceLines: 'id, invoiceId',
      salesReturns: 'id, &number, originalInvoiceId, customerId, issuedAt',
      salesReturnLines: 'id, returnId, originalLineId',
      purchaseInvoices: 'id, &number, supplierId, issuedAt',
      purchaseInvoiceLines: 'id, invoiceId',
      purchaseReturns: 'id, &number, supplierId, issuedAt',
      purchaseReturnLines: 'id, returnId',
      customerReceipts: 'id, &number, customerId, issuedAt',
      supplierPayments: 'id, &number, supplierId, issuedAt',
      stockAdjustments: 'id, &number, issuedAt',
      stockAdjustmentLines: 'id, adjustmentId',
      expenses: 'id, &number, categoryId, issuedAt',
      cashTransfers: 'id, &number, issuedAt',
      voids: 'id, &number, targetId',
      openings: 'id, &number, kind',
      payments: 'id, [documentType+documentId]',
      stockMovements: 'id, [productId+warehouseId], docId, occurredAt',
      partyLedger: 'id, [partyType+partyId], docId',
      cashMovements: 'id, cashAccountId, shiftId, docId, occurredAt',
      auditLog: 'id, occurredAt',
      clientErrors: 'id',
      outbox: '++seq, status',
      syncState: 'key',
      numberSequences: 'type',
      heldCarts: 'id',
      stockBalances: '[productId+warehouseId]',
      partyBalances: '[partyType+partyId]',
      deviceSettings: 'key',
      searchIndex: 'token',
    });
    // v2: name indexes for the manager's sorted lists
    this.version(2).stores({
      products: 'id, sku, categoryId, updatedAt, name',
      customers: 'id, phone, name',
      suppliers: 'id, name',
    });
  }
}
