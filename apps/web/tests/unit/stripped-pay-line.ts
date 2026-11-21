import type { PayPeriodLine, ViewedPayLine } from "@workspace/shared";

/**
 * A pay line as the API sends it to someone without hr.employee.view_sensitive: the response
 * interceptor drops `baseRate`, `salaryAmount` and each week's `regularRate` (CLAUDE.md rule 5).
 */
export function strippedPayLine(line: PayPeriodLine): ViewedPayLine {
  const sent: ViewedPayLine = { ...line, weeks: line.weeks.map((week) => ({ ...week })) };
  for (const week of sent.weeks) delete week.regularRate;
  delete sent.baseRate;
  delete sent.salaryAmount;
  return sent;
}
