import type { Piasters } from './money';

export type PayrollKind = 'advance' | 'deduction' | 'salary';

/** The slice of a payroll entry the rules need. */
export interface PayrollEntry {
  id?: string;
  number?: string;
  note?: string | null;
  employeeId: string;
  kind: PayrollKind;
  /** yyyy-mm the entry belongs to */
  month: string;
  amount: Piasters;
  issuedAt: string;
  status: 'posted' | 'voided';
  /** salary entries: what was paid and what could not be covered */
  net: Piasters | null;
  carryOut: Piasters | null;
}

export interface SalarySlip {
  gross: Piasters;
  deductionsTotal: Piasters;
  advancesTotal: Piasters;
  carryIn: Piasters;
  net: Piasters;
  carryOut: Piasters;
}

/** The salary pays what is left after deductions, advances and the shortfall carried in; what it cannot cover carries out. Mirrors the server. */
export function salarySlip(i: {
  salary: Piasters;
  deductions: Piasters;
  advances: Piasters;
  carryIn: Piasters;
}): SalarySlip {
  const owed = i.deductions + i.advances + i.carryIn;
  return {
    gross: i.salary,
    deductionsTotal: i.deductions,
    advancesTotal: i.advances,
    carryIn: i.carryIn,
    net: Math.max(0, i.salary - owed),
    carryOut: Math.max(0, owed - i.salary),
  };
}

export interface PayrollState {
  advances: Piasters;
  deductions: Piasters;
  carryIn: Piasters;
  /** a salary for this month was already paid */
  paid: boolean;
  slip: SalarySlip;
}

/** One worker's position for a month: advances since his last salary, the month's deductions, what carried in. */
export function payrollState(
  entries: PayrollEntry[],
  employeeId: string,
  salary: Piasters,
  month: string,
): PayrollState {
  const mine = entries.filter((x) => x.employeeId === employeeId && x.status === 'posted');
  const salaries = mine
    .filter((x) => x.kind === 'salary')
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const last = salaries[0];
  const advances = mine
    .filter((x) => x.kind === 'advance' && (!last || x.issuedAt > last.issuedAt))
    .reduce((a, x) => a + x.amount, 0);
  const deductions = mine
    .filter((x) => x.kind === 'deduction' && x.month === month)
    .reduce((a, x) => a + x.amount, 0);
  const carryIn = last?.carryOut ?? 0;
  return {
    advances,
    deductions,
    carryIn,
    paid: salaries.some((x) => x.month === month),
    slip: salarySlip({ salary, deductions, advances, carryIn }),
  };
}

/** An advance a later salary took, or a deduction of a month already paid, can no longer be deleted or changed (owner decision 2026-10-18). */
export function payrollEntryLocked(entries: PayrollEntry[], entry: PayrollEntry): boolean {
  const salaries = entries.filter(
    (x) => x.employeeId === entry.employeeId && x.kind === 'salary' && x.status === 'posted',
  );
  if (entry.kind === 'deduction') return salaries.some((x) => x.month === entry.month);
  if (entry.kind === 'advance') return salaries.some((x) => x.issuedAt > entry.issuedAt);
  return true;
}
