import type { BusinessReport, BusinessRow, BusinessSection, DrillRecord } from "../business-report";
import { dec, sum } from "../money";

/** The most drill records a row carries (ADR 0055 S8); the screen says how many there are in all. */
export const DRILL_LIMIT = 200;

/** Plain code-unit order, so the API and every browser sort the same way whatever their locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Newest first, then by label, so a cut keeps the latest records and ties never shuffle. */
const newestFirst = (a: DrillRecord, b: DrillRecord) => byText(b.date, a.date) || byText(a.label, b.label);

function capRow(row: BusinessRow, limit: number): BusinessRow {
  const records = [...row.records].sort(newestFirst);
  if (records.length <= limit) return { ...row, records };
  return { ...row, records: records.slice(0, limit), recordCount: records.length };
}

/**
 * The report with each row's drill records sorted newest first (then by label) and cut to `limit`
 * (ADR 0055 S8). A cut row keeps `recordCount`, the number of records it had, so the sheet can say
 * "Showing the latest 200 of N records." instead of stopping silently. Values are unchanged.
 */
export function capDrillRecords(report: BusinessReport, limit = DRILL_LIMIT): BusinessReport {
  return {
    ...report,
    sections: report.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => capRow(row, limit)),
      total: section.total ? capRow(section.total, limit) : null,
    })),
  };
}

/** The total line under a drill list (click-through finding #40). */
export interface DrillTotal {
  /** The sum of the records listed, a decimal string. */
  total: string;
  /** The figure that was clicked: the row's first money value. */
  figure: string;
  /** True when the list is whole and its sum is the figure, so the line can just say "Total". */
  matches: boolean;
}

/**
 * The total under a drill list (spec F2 drill-down; finding #40): the sum of the records and the
 * figure the reader clicked, which is the row's value in the section's first money column
 * (This period on the Summary, Revenue on Profit by location, Cost on the expense sections). Some
 * figures are worked out from more than their records (operating expenses also count pay periods,
 * a product category's revenue is only part of each whole invoice listed) and a list may be cut to
 * the latest records, so `matches` says whether the two agree. Null for a row with no records.
 */
export function drillTotal(section: Pick<BusinessSection, "columns">, row: BusinessRow): DrillTotal | null {
  if (row.records.length === 0 || row.kind === "percent") return null;
  const column = section.columns.find((c) => c.kind === "money" && row.values[c.id]);
  if (!column) return null;
  const figure = row.values[column.id]!;
  const total = sum(row.records.map((r) => r.amount));
  return { total: total.toString(), figure, matches: row.recordCount === undefined && total.eq(dec(figure)) };
}
