export type Role = 'cashier' | 'storekeeper' | 'manager';

/** Every screen, report tab and button is one action. Group them with PERMISSION_SECTIONS for the editor. */
export const ACTIONS = [
  // sale screen
  'view.sell',
  'view.salesInvoices',
  'sell',
  'holdCart',
  'returnWithInvoice',
  'returnWithoutInvoice',
  'discountWithinLimit',
  'discountOverLimit',
  'priceOverride',
  'creditOverLimit',
  'noSaleDrawer',
  'void',
  'voidReturn',
  'customerReceipt',
  'addCustomer',
  // products and stock
  'view.products',
  'view.categories',
  'editProductData',
  'archiveProduct',
  'editPrices',
  'seeCost',
  'addProduct',
  'editCategory',
  'viewProductHistory',
  'view.stock',
  'stockAdjustment',
  'stockAdjustmentOverLimit',
  // purchases and suppliers
  'view.purchases',
  'receivePurchase',
  'purchaseReturn',
  'purchaseReturnWithoutInvoice',
  'voidPurchase',
  'editReturnValue',
  'payFromOwner',
  'view.suppliers',
  'addSupplier',
  'supplierPayment',
  // customers
  'view.customers',
  'addCustomerFull',
  // cash
  'view.expenses',
  'recordExpense',
  'expenseOverLimit',
  'expenseAnyAccount',
  'cashTransfer',
  'cashTransferAny',
  'cashAdjustment',
  'shiftVarianceApprove',
  // reports
  'view.reports',
  'report.smart',
  'report.safe',
  'report.sales',
  'report.profit',
  'report.exceptions',
  'report.devices',
  'report.stock',
  'report.expenses',
  'report.categories',
  'report.productHistory',
  'report.purchases',
  'report.payroll',
  'report.returns',
  'printReports',
  'exportCsv',
  // payroll
  'view.payroll',
  'managePayroll',
  // administration
  'view.workers',
  'manageUsers',
  'manageGroups',
  'view.settings',
  'settings',
] as const;
export type Action = (typeof ACTIONS)[number];

/** `pin` = allowed after a worker who has this action as `yes` enters his PIN on the same device. */
export type Access = 'yes' | 'pin' | 'no';

/** What a permission group stores: one explicit access per action. */
export type Permissions = Partial<Record<Action, Access>>;

export interface PermissionSection {
  key: string;
  actions: Action[];
}

const section = (key: string, prefix: (a: Action) => boolean): PermissionSection => ({
  key,
  actions: ACTIONS.filter(prefix),
});

/** The editor shows one card per section; every action appears in exactly one. */
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'sell',
    actions: [
      'view.sell',
      'view.salesInvoices',
      'sell',
      'holdCart',
      'returnWithInvoice',
      'returnWithoutInvoice',
      'discountWithinLimit',
      'discountOverLimit',
      'priceOverride',
      'creditOverLimit',
      'noSaleDrawer',
      'void',
      'voidReturn',
      'customerReceipt',
      'addCustomer',
    ],
  },
  {
    key: 'products',
    actions: [
      'view.products',
      'view.categories',
      'editProductData',
      'archiveProduct',
      'editPrices',
      'seeCost',
      'addProduct',
      'editCategory',
      'viewProductHistory',
    ],
  },
  { key: 'stock', actions: ['view.stock', 'stockAdjustment', 'stockAdjustmentOverLimit'] },
  {
    key: 'purchases',
    actions: [
      'view.purchases',
      'receivePurchase',
      'purchaseReturn',
      'purchaseReturnWithoutInvoice',
      'voidPurchase',
      'editReturnValue',
      'payFromOwner',
    ],
  },
  { key: 'suppliers', actions: ['view.suppliers', 'addSupplier', 'supplierPayment'] },
  { key: 'customers', actions: ['view.customers', 'addCustomerFull'] },
  {
    key: 'cash',
    actions: [
      'view.expenses',
      'recordExpense',
      'expenseOverLimit',
      'expenseAnyAccount',
      'cashTransfer',
      'cashTransferAny',
      'cashAdjustment',
      'shiftVarianceApprove',
    ],
  },
  section(
    'reports',
    (a) => a.startsWith('report.') || a === 'view.reports' || a === 'printReports' || a === 'exportCsv',
  ),
  { key: 'payroll', actions: ['view.payroll', 'managePayroll'] },
  { key: 'admin', actions: ['view.workers', 'manageUsers', 'manageGroups', 'view.settings', 'settings'] },
];

const cashier: Permissions = {
  'view.sell': 'yes',
  sell: 'yes',
  holdCart: 'yes',
  returnWithInvoice: 'yes',
  discountWithinLimit: 'yes',
  discountOverLimit: 'pin',
  priceOverride: 'pin',
  creditOverLimit: 'pin',
  noSaleDrawer: 'pin',
  customerReceipt: 'yes',
  addCustomer: 'yes',
  recordExpense: 'yes',
  cashTransfer: 'yes',
};
const storekeeper: Permissions = {
  'view.products': 'yes',
  'view.categories': 'yes',
  'view.purchases': 'yes',
  'view.stock': 'yes',
  receivePurchase: 'yes',
  stockAdjustment: 'yes',
  editProductData: 'yes',
  addProduct: 'yes',
  purchaseReturnWithoutInvoice: 'yes',
};

/** The built-in access of a role: what a worker without a permission group gets. Managers get everything. */
export function defaultsFor(role: Role): Permissions {
  if (role === 'manager') return Object.fromEntries(ACTIONS.map((a) => [a, 'yes' as Access]));
  return role === 'cashier' ? cashier : storekeeper;
}

/** A manager can never lock himself out of these, whatever his group says. */
export const MANAGER_ALWAYS: Action[] = [
  'view.workers',
  'manageUsers',
  'manageGroups',
  'view.settings',
  'settings',
];

/**
 * One rule for the screens, the commands and (as worker_can in SQL) the server.
 * No group: the role's defaults. With a group: the group is the whole truth, a missing action is `no`.
 */
export function resolveAccess(role: Role, groupPermissions: Permissions | null, action: Action): Access {
  if (role === 'manager' && MANAGER_ALWAYS.includes(action)) return 'yes';
  if (groupPermissions) return groupPermissions[action] ?? 'no';
  return defaultsFor(role)[action] ?? 'no';
}

/** Role-only check, kept for the server-side table comparison and places that have no worker yet. */
export function can(role: Role, action: Action): Access {
  return resolveAccess(role, null, action);
}
