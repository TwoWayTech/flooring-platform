import type { CompanyDb } from "@workspace/db";
import type { Location, ProfitData } from "@workspace/shared";
import {
  loadAdjustmentRows,
  loadEmployeeRows,
  loadExpenseRows,
  loadInvoiceHeads,
  loadInvoiceHeadsById,
  loadPayRows,
  loadSalesLines,
  loadSharedCosts,
  withLines,
} from "./report-records";

/**
 * What the shared profit calculation reads for whole months in [from, to] (ADR 0061 decision 2),
 * the same documents the Business report reads for that period: every live head issued in the
 * window (a month's revenue weights need them all, rule 6), the lines of the non-void ones, heads
 * named by write-offs in the window whatever their issue date (rule 8), expenses, pay periods and
 * the employees they pay (with pay sight only; ADR 0055 S3), the live locations given and the
 * shared-cost rule.
 * Product categories are not read: Profit and loss has no product category filter.
 */
export async function loadProfitData(
  tx: CompanyDb,
  zone: string,
  w: { from: string; to: string; payroll: boolean },
  locations: readonly Location[],
): Promise<ProfitData> {
  const heads = await loadInvoiceHeads(tx, zone, { from: w.from, to: w.to });
  const adjustments = await loadAdjustmentRows(tx, zone, w.to);
  const known = new Set(heads.map((head) => head.id));
  const writtenOff = adjustments
    .filter((a) => a.kind === "write_off" && a.at.slice(0, 10) >= w.from && !known.has(a.invoiceId))
    .map((a) => a.invoiceId);
  const allHeads = [...heads, ...(await loadInvoiceHeadsById(tx, zone, [...new Set(writtenOff)]))];
  const counted = new Set(heads.filter((head) => !head.voidedAt).map((head) => head.id));
  const lines = await loadSalesLines(tx, { from: w.from, to: w.to }, counted);
  const payPeriods = w.payroll ? await loadPayRows(tx, w.from, w.to) : [];
  const employeeIds = [...new Set(payPeriods.flatMap((period) => period.lines.map((line) => line.employeeId)))];
  return {
    invoices: withLines(allHeads, lines),
    expenses: await loadExpenseRows(tx, { from: w.from, to: w.to, payroll: w.payroll }),
    adjustments,
    payPeriods,
    employees: await loadEmployeeRows(tx, employeeIds),
    locations: locations.map(({ id, name, kind, floorAreaSqFt }) => ({
      id,
      name,
      kind,
      ...(floorAreaSqFt === undefined ? {} : { floorAreaSqFt }),
    })),
    productCategories: [],
    settings: { sharedCosts: await loadSharedCosts(tx) },
  };
}
