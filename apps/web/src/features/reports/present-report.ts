import { format, parseISO } from "date-fns";
import type { Report } from "@workspace/shared";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * A hub report as people read it (ADR 0055): the API sends raw days (yyyy-MM-dd) and months
 * (yyyy-MM) so every client formats them its own way; this formats the `format: "date"` columns of
 * each row with the company's date pattern and the `format: "month"` ones as "MMM yyyy". The totals
 * row is left alone ("Total" is text, the rest are numbers). The screen, the CSV and the PDF all
 * print this one result, so they keep matching (spec rule 2).
 */
export function presentReport(report: Report, formatDate: (iso: string) => string): Report {
  const dated = report.columns.filter((c) => c.format);
  if (dated.length === 0) return report;
  const rows = report.rows.map((row) => {
    const shown = { ...row };
    for (const column of dated) {
      const raw = row[column.id];
      if (column.format === "date" && raw && DAY.test(raw)) shown[column.id] = formatDate(raw);
      if (column.format === "month" && raw && MONTH.test(raw)) {
        shown[column.id] = format(parseISO(`${raw}-01`), "MMM yyyy");
      }
    }
    return shown;
  });
  return { ...report, rows };
}
