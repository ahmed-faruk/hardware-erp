import type { DocType } from '@/domain/numbering';
import type { Permissions } from '@/domain/permissions';

/** Columns every synced row carries (docs/DATABASE.md §3). Local ids are UUID v7; times are ISO strings. */
export interface Common {
  id: string;
  companyId: string;
  deviceId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  deletedAt: string | null;
  serverSeq?: number;
}

export interface DocCommon extends Common {
  number: string;
  issuedAt: string;
  workerId: string | null;
  shiftId: string | null;
  status: 'posted' | 'voided';
  voidedBy: string | null;
  notes: string | null;
  isLegacy: boolean;
  legacy: unknown;
}

export type Role = 'cashier' | 'storekeeper' | 'manager';

export interface Company extends Common {
  name: string;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  logoPath: string | null;
}
export interface Branch extends Common {
  name: string;
}
export interface Warehouse extends Common {
  branchId: string | null;
  name: string;
  kind: 'main' | 'showroom' | 'scrap';
  legacyLocationId: number | null;
}
export interface Device extends Common {
  branchId: string | null;
  authUserId: string | null;
  name: string;
  prefix: string;
  kind: 'pc' | 'mobile';
  maxRole: Role;
  lastSeenAt: string | null;
  appVersion: string | null;
  revokedAt: string | null;
}
export interface Worker extends Common {
  name: string;
  role: Role;
  pinHash: string | null;
  pinSalt: string | null;
  photoPath: string | null;
  active: boolean;
  legacyEmployeeId: number | null;
  /** permission group; null/absent = the role's defaults */
  groupId?: string | null;
}
export interface PermissionGroup extends Common {
  name: string;
  permissions: Permissions;
}
export interface Setting extends Common {
  key: string;
  value: unknown;
}
export interface CashAccount extends Common {
  name: string;
  kind: 'drawer' | 'safe' | 'bank' | 'wallet' | 'card_clearing';
  ownerDeviceId: string | null;
}
export interface ExpenseCategory extends Common {
  name: string;
  icon: string | null;
}

export interface Category extends Common {
  parentId: string | null;
  name: string;
  colorToken: string | null;
  icon: string | null;
  sort: number;
}
export interface Product extends Common {
  sku: string | null;
  name: string;
  categoryId: string | null;
  type: 'stock' | 'service';
  baseUnitName: string;
  qtyDecimals: number;
  price: number;
  /** POS-10: the price on each customer list; null = same as retail */
  priceWholesale?: number | null;
  priceCraftsman?: number | null;
  priceContractor?: number | null;
  unitCost: number;
  reorderLevel: number;
  defaultSupplierId: string | null;
  imagePath: string | null;
  extraFields: unknown;
  active: boolean;
  legacyItemId: number | null;
}
export interface ProductUnit extends Common {
  productId: string;
  name: string;
  factor: number;
  price: number | null;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}
export interface Barcode extends Common {
  productId: string;
  productUnitId: string | null;
  code: string;
}
export interface Customer extends Common {
  name: string;
  phone: string | null;
  address: string | null;
  company: string | null;
  notes: string | null;
  creditLimit: number;
  defaultDiscountBp: number;
  priceList?: 'retail' | 'wholesale' | 'craftsman' | 'contractor';
  photoPath: string | null;
  active: boolean;
  legacyPersonId: number | null;
}
export interface Supplier extends Common {
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isExpenseSupplier: boolean;
  active: boolean;
  legacyPersonId: number | null;
}

export interface Shift extends Common {
  number: string;
  workerId: string | null;
  cashAccountId: string | null;
  openedAt: string;
  openingFloat: number;
  closedAt: string | null;
  countedTotal: number | null;
  countedBreakdown: unknown;
  expectedTotal: number | null;
  variance: number | null;
  closeNote: string | null;
  /** the manager who approved a drawer difference above the limit */
  approvedBy?: string | null;
  status: 'open' | 'closed';
}
export interface SalesInvoice extends DocCommon {
  customerId: string | null;
  warehouseId: string | null;
  subtotal: number;
  lineDiscountTotal: number;
  invoiceDiscount: number;
  taxTotal: number;
  cashRounding: number;
  total: number;
  cashTendered: number;
  changeDue: number;
}
export interface SalesInvoiceLine extends Common {
  invoiceId: string;
  lineNo: number;
  productId: string | null;
  productUnitId: string | null;
  unitFactor: number;
  qty: number;
  unitPrice: number;
  lineDiscount: number;
  allocDiscount: number;
  taxAmount: number;
  netAmount: number;
  unitCost: number;
  warehouseId: string | null;
  legacyText: string | null;
}
export interface Payment extends Common {
  documentType: string;
  documentId: string;
  method: 'cash' | 'credit' | 'card' | 'instapay' | 'wallet' | 'other';
  amount: number;
  reference: string | null;
  cashAccountId: string | null;
}
export interface StockMovement extends Common {
  productId: string;
  warehouseId: string;
  qty: number;
  unitCost: number;
  docType: string;
  docId: string;
  lineId: string | null;
  occurredAt: string;
}
export interface PartyLedgerRow extends Common {
  partyType: 'customer' | 'supplier';
  partyId: string;
  amount: number;
  docType: string;
  docId: string;
  occurredAt: string;
}
export interface CashMovement extends Common {
  cashAccountId: string;
  shiftId: string | null;
  amount: number;
  method: string;
  docType: string;
  docId: string;
  occurredAt: string;
}
export interface AuditRow extends Common {
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  workerId: string | null;
  approvedBy: string | null;
  occurredAt: string;
}
/** Tables whose rows are not written by a command in phase 3 are typed loosely until their phase. */
export type DocRow = DocCommon & Record<string, unknown>;
export type LooseRow = Common & Record<string, unknown>;

export type OutboxStatus = 'pending' | 'sent' | 'rejected';
export interface OutboxRow {
  seq?: number;
  deviceSeq: number;
  table: string;
  id: string;
  op: 'upsert';
  /** the worker who performed the action (checked against the permission matrix on the server) */
  workerId: string | null;
  payload: Record<string, unknown>;
  changedFields: string[] | null;
  baseVersion: number | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
export interface SyncStateRow {
  key: string;
  value: unknown;
}
export interface NumberSequence {
  type: DocType;
  next: number;
}
export interface StockBalance {
  productId: string;
  warehouseId: string;
  qty: number;
}
export interface PartyBalance {
  partyType: 'customer' | 'supplier';
  partyId: string;
  amount: number;
}
export interface KeyValue {
  key: string;
  value: unknown;
}
export interface HeldCart {
  id: string;
  payload: unknown;
  updatedAt: string;
}
export interface SearchToken {
  token: string;
  productIds: string[];
}
