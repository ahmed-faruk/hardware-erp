import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER,
  cairoDayStartIso,
  isEmptyFilter,
  matchesInvoice,
  type InvoiceFilter,
  type InvoiceRow,
} from './invoice-filter';

const row = (patch: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 'i1',
  number: 'K1-INV-000245',
  day: '2026-10-10',
  partyName: 'عميل أحمد',
  status: 'posted',
  hasReturn: false,
  methods: ['cash', 'card'],
  total: 15000,
  productIds: ['p1', 'p2'],
  workerId: 'w1',
  deviceId: 'd1',
  shiftId: 's1',
  ...patch,
});
const f = (patch: Partial<InvoiceFilter>): InvoiceFilter => ({ ...EMPTY_FILTER, ...patch });

describe('invoice filters (P6)', () => {
  it('no filter keeps everything', () => {
    expect(matchesInvoice(row(), EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter(f({ party: 'x' }))).toBe(false);
  });

  it('number: any part, any case, digits only too', () => {
    expect(matchesInvoice(row(), f({ number: '000245' }))).toBe(true);
    expect(matchesInvoice(row(), f({ number: 'k1-inv' }))).toBe(true);
    expect(matchesInvoice(row(), f({ number: '000246' }))).toBe(false);
  });

  it('dates: both ends included, either end alone works', () => {
    expect(matchesInvoice(row(), f({ from: '2026-10-10', to: '2026-10-10' }))).toBe(true);
    expect(matchesInvoice(row(), f({ from: '2026-10-11' }))).toBe(false);
    expect(matchesInvoice(row(), f({ to: '2026-10-09' }))).toBe(false);
    expect(matchesInvoice(row(), f({ from: '2026-10-01', to: '2026-10-31' }))).toBe(true);
  });

  it('customer or supplier name: part of the name', () => {
    expect(matchesInvoice(row(), f({ party: 'أحمد' }))).toBe(true);
    expect(matchesInvoice(row(), f({ party: 'محمود' }))).toBe(false);
    expect(matchesInvoice(row({ partyName: '' }), f({ party: 'أحمد' }))).toBe(false);
  });

  it('status: posted, voided, and returned (a posted return exists)', () => {
    expect(matchesInvoice(row({ status: 'voided' }), f({ status: 'posted' }))).toBe(false);
    expect(matchesInvoice(row({ status: 'voided' }), f({ status: 'voided' }))).toBe(true);
    expect(matchesInvoice(row(), f({ status: 'returned' }))).toBe(false);
    expect(matchesInvoice(row({ hasReturn: true }), f({ status: 'returned' }))).toBe(true);
    // a voided invoice is not «returned», whatever it once had
    expect(matchesInvoice(row({ status: 'voided', hasReturn: true }), f({ status: 'returned' }))).toBe(false);
  });

  it('payment method: the invoice has a payment of that method', () => {
    expect(matchesInvoice(row(), f({ method: 'card' }))).toBe(true);
    expect(matchesInvoice(row(), f({ method: 'credit' }))).toBe(false);
  });

  it('amount: limits are inclusive, either alone works, zero is a real limit', () => {
    expect(matchesInvoice(row(), f({ minAmount: 15000, maxAmount: 15000 }))).toBe(true);
    expect(matchesInvoice(row(), f({ minAmount: 15001 }))).toBe(false);
    expect(matchesInvoice(row(), f({ maxAmount: 14999 }))).toBe(false);
    expect(matchesInvoice(row({ total: 0 }), f({ maxAmount: 0 }))).toBe(true);
  });

  it('product: any of the resolved ids; an empty list matches nothing, null means no filter', () => {
    expect(matchesInvoice(row(), f({ productIds: ['p2', 'p9'] }))).toBe(true);
    expect(matchesInvoice(row(), f({ productIds: ['p9'] }))).toBe(false);
    expect(matchesInvoice(row(), f({ productIds: [] }))).toBe(false);
    expect(matchesInvoice(row(), f({ productIds: null }))).toBe(true);
  });

  it('worker, device and shift', () => {
    expect(matchesInvoice(row(), f({ workerId: 'w1', deviceId: 'd1', shiftId: 's1' }))).toBe(true);
    expect(matchesInvoice(row(), f({ workerId: 'w2' }))).toBe(false);
    expect(matchesInvoice(row(), f({ deviceId: 'd2' }))).toBe(false);
    expect(matchesInvoice(row({ shiftId: null }), f({ shiftId: 's1' }))).toBe(false);
  });

  it('all filters together are ANDed', () => {
    const all = f({
      number: '245',
      from: '2026-10-01',
      party: 'أحمد',
      status: 'posted',
      method: 'cash',
      minAmount: 1,
      productIds: ['p1'],
      workerId: 'w1',
    });
    expect(matchesInvoice(row(), all)).toBe(true);
    expect(matchesInvoice(row({ workerId: 'w9' }), all)).toBe(false);
  });
});

describe('the start of a Cairo day', () => {
  it('is 22:00 UTC the day before in winter (UTC+2) and 21:00 UTC in summer (UTC+3)', () => {
    expect(cairoDayStartIso('2026-01-15')).toBe('2026-01-14T22:00:00.000Z');
    expect(cairoDayStartIso('2026-07-15')).toBe('2026-07-14T21:00:00.000Z');
  });
  it('an invoice at 23:30 UTC on 30 Sep in October is already 1 Oct in Cairo (summer time)', () => {
    expect(new Date('2026-09-30T23:30:00.000Z').toISOString() >= cairoDayStartIso('2026-10-01')).toBe(true);
    expect(new Date('2026-09-30T20:59:00.000Z').toISOString() >= cairoDayStartIso('2026-10-01')).toBe(false);
  });
});
