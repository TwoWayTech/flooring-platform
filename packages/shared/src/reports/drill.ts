import type { BusinessReport, BusinessRow, DrillRecord } from "../business-report";

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
