import { describe, expect, it } from 'vitest';

import { payrollEntryLocked, payrollState, salarySlip, type PayrollEntry } from './payroll';

describe('salarySlip', () => {
  it('pays what is left after the advances, the deductions and what carried in', () => {
    expect(salarySlip({ salary: 300000, deductions: 10000, advances: 50000, carryIn: 0 })).toEqual({
      gross: 300000,
      deductionsTotal: 10000,
      advancesTotal: 50000,
      carryIn: 0,
      net: 240000,
      carryOut: 0,
    });
  });
  it('pays nothing and carries the shortfall when the salary cannot cover it', () => {
    expect(salarySlip({ salary: 300000, deductions: 0, advances: 350000, carryIn: 0 })).toMatchObject({
      net: 0,
      carryOut: 50000,
    });
  });
  it('takes the carried amount off the next salary, and can carry on again', () => {
    expect(salarySlip({ salary: 300000, deductions: 0, advances: 0, carryIn: 50000 })).toMatchObject({
      net: 250000,
      carryOut: 0,
    });
    expect(salarySlip({ salary: 100000, deductions: 0, advances: 100000, carryIn: 50000 })).toMatchObject({
      net: 0,
      carryOut: 50000,
    });
  });
});

const e = (p: Partial<PayrollEntry>): PayrollEntry => ({
  employeeId: 'w1',
  kind: 'advance',
  month: '2026-10',
  amount: 0,
  issuedAt: '2026-10-05T10:00:00Z',
  status: 'posted',
  net: null,
  carryOut: null,
  ...p,
});

describe('payrollState', () => {
  const entries: PayrollEntry[] = [
    e({ kind: 'advance', amount: 50000, issuedAt: '2026-10-05T10:00:00Z' }),
    e({ kind: 'deduction', amount: 10000, issuedAt: '2026-10-07T10:00:00Z' }),
    e({ kind: 'advance', amount: 99999, status: 'voided' }),
    e({ employeeId: 'other', kind: 'advance', amount: 77777 }),
  ];
  it('collects the advances since his last salary and the month deductions', () => {
    const s = payrollState(entries, 'w1', 300000, '2026-10');
    expect(s.advances).toBe(50000);
    expect(s.deductions).toBe(10000);
    expect(s.paid).toBe(false);
    expect(s.slip.net).toBe(240000);
  });
  it('after a salary, only the later advances count, and its carry comes in', () => {
    const later = [
      ...entries,
      e({
        kind: 'salary',
        month: '2026-10',
        amount: 240000,
        net: 240000,
        carryOut: 20000,
        issuedAt: '2026-10-31T10:00:00Z',
      }),
      e({ kind: 'advance', month: '2026-11', amount: 30000, issuedAt: '2026-11-04T10:00:00Z' }),
    ];
    const nov = payrollState(later, 'w1', 300000, '2026-11');
    expect(nov.advances).toBe(30000);
    expect(nov.carryIn).toBe(20000);
    expect(nov.slip.net).toBe(250000);
    expect(payrollState(later, 'w1', 300000, '2026-10').paid).toBe(true);
  });
});

describe('payrollEntryLocked', () => {
  const base = { employeeId: 'w1', status: 'posted' as const, net: null, carryOut: null };
  const salary: PayrollEntry = {
    ...base,
    kind: 'salary',
    month: '2026-09',
    amount: 100000,
    issuedAt: '2026-09-30T10:00:00Z',
  };
  it('locks a deduction of a paid month only', () => {
    const paid: PayrollEntry = {
      ...base,
      kind: 'deduction',
      month: '2026-09',
      amount: 100,
      issuedAt: '2026-09-10T10:00:00Z',
    };
    const open: PayrollEntry = { ...paid, month: '2026-10', issuedAt: '2026-10-02T10:00:00Z' };
    expect(payrollEntryLocked([salary, paid, open], paid)).toBe(true);
    expect(payrollEntryLocked([salary, paid, open], open)).toBe(false);
  });
  it('locks an advance a later salary took, not one given after it', () => {
    const before: PayrollEntry = {
      ...base,
      kind: 'advance',
      month: '2026-09',
      amount: 500,
      issuedAt: '2026-09-15T10:00:00Z',
    };
    const after: PayrollEntry = { ...before, month: '2026-10', issuedAt: '2026-10-01T10:00:00Z' };
    expect(payrollEntryLocked([salary, before, after], before)).toBe(true);
    expect(payrollEntryLocked([salary, before, after], after)).toBe(false);
  });
  it('a voided salary locks nothing; a salary entry itself is always locked', () => {
    const before: PayrollEntry = {
      ...base,
      kind: 'advance',
      month: '2026-09',
      amount: 500,
      issuedAt: '2026-09-15T10:00:00Z',
    };
    expect(payrollEntryLocked([{ ...salary, status: 'voided' }, before], before)).toBe(false);
    expect(payrollEntryLocked([salary], salary)).toBe(true);
  });
});
