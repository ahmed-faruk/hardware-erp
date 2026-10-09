import { z } from 'zod';

const int = z.number().int();
const id = z.string().min(1).max(64);

export const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percentBp'), valueBp: int.min(0).max(10000) }),
  z.object({ kind: z.literal('fixed'), value: int.min(0) }),
]);

export const saleLineSchema = z.object({
  productId: id,
  productUnitId: id.nullable().optional(),
  unitFactorMilli: int.positive().default(1000),
  qtyMilli: int.positive(),
  unitPrice: int.min(0),
  discount: discountSchema.optional(),
});

export const paymentSchema = z.object({
  method: z.enum(['cash', 'credit', 'card', 'instapay', 'wallet']),
  amount: int.positive(),
  tendered: int.positive().optional(),
  reference: z.string().max(64).optional(),
});

export const saleInputSchema = z.object({
  lines: z.array(saleLineSchema).min(1).max(200),
  customerId: id.nullable().default(null),
  payments: z.array(paymentSchema).min(1).max(10),
  invoiceDiscount: discountSchema.nullable().default(null),
  warehouseId: id,
  shiftId: id,
  cashAccountId: id,
  isOffline: z.boolean().default(false),
  creditPolicy: z
    .union([z.literal('allow'), z.literal('block'), z.object({ reduceByBp: int.min(0).max(10000) })])
    .default('allow'),
  managerApproved: z.boolean().default(false),
});
export type SaleInput = z.input<typeof saleInputSchema>;

export const openShiftSchema = z.object({ cashAccountId: id, openingFloat: int.min(0) });

const text = z.string().trim().min(1).max(200);
const optText = z.string().trim().max(500).nullable();

export const productFieldsSchema = z
  .object({
    sku: z.string().trim().max(64).nullable(),
    name: text,
    categoryId: id.nullable(),
    type: z.enum(['stock', 'service']),
    baseUnitName: text,
    qtyDecimals: int.min(0).max(3),
    price: int.min(0),
    unitCost: int.min(0),
    reorderLevel: int.min(0),
    defaultSupplierId: id.nullable(),
    imagePath: optText,
    extraFields: z
      .object({ icon: z.string().max(40).nullable() })
      .partial()
      .strict()
      .nullable(),
    active: z.boolean(),
    deletedAt: z.string().nullable(),
  })
  .partial()
  .strict();

/** Scanner and typed codes: printable ASCII only, at most 64 characters (docs/SECURITY.md §4). */
export const barcodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\x21-\x7e]+$/);
export const barcodesSchema = z.array(barcodeSchema).max(20);

/** One pack unit per product in the MVP (docs/PRD.md §6): factor in milli base units (carton of 12 = 12000). */
export const packUnitSchema = z
  .object({ name: text, factorMilli: int.positive(), price: int.min(0).nullable() })
  .strict();

export const customerFieldsSchema = z
  .object({
    name: text,
    phone: z.string().trim().max(32).nullable(),
    address: optText,
    company: optText,
    notes: optText,
    creditLimit: int.min(0),
    defaultDiscountBp: int.min(0).max(10000),
    photoPath: optText,
    active: z.boolean(),
    deletedAt: z.string().nullable(),
  })
  .partial()
  .strict();

export const supplierFieldsSchema = z
  .object({
    name: text,
    contactName: optText,
    phone: z.string().trim().max(32).nullable(),
    address: optText,
    notes: optText,
    active: z.boolean(),
    deletedAt: z.string().nullable(),
  })
  .partial()
  .strict();

export const categoryFieldsSchema = z
  .object({
    name: text,
    parentId: id.nullable(),
    colorToken: z.string().max(16).nullable(),
    icon: z.string().max(40).nullable(),
    sort: int.min(0),
    deletedAt: z.string().nullable(),
  })
  .partial()
  .strict();

/** `pin` is hashed by the command and never stored (docs/SECURITY.md §2). */
export const workerFieldsSchema = z
  .object({
    name: text,
    role: z.enum(['cashier', 'storekeeper', 'manager']),
    active: z.boolean(),
    pin: z.string().regex(/^\d{6,12}$/),
  })
  .partial()
  .strict();
