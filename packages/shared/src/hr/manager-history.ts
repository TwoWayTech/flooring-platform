/**
 * One row of an employee's dated manager history (company table employee_manager_history; owner
 * decision 2026-11-15, ADR 0048). Rows are appended, never changed.
 */
export interface ManagerHistoryRow {
  employeeId: string;
  /** The manager's employee id from `effectiveFrom`; null means no manager. */
  managerId: string | null;
  /** The first day this manager applies, YYYY-MM-DD; null means since records began. */
  effectiveFrom: string | null;
  /**
   * Text that sorts in the order the rows were recorded, such as the row's UUID v7 id; it breaks a
   * tie between two rows from the same day, the later recorded one winning.
   */
  recordedOrder: string;
}

/** Earliest first: since-records-began rows, then by day, then by when they were recorded. */
function byEffectiveDay(a: ManagerHistoryRow, b: ManagerHistoryRow): number {
  const day = (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? "");
  if (day !== 0) return day;
  if (a.recordedOrder === b.recordedOrder) return 0;
  return a.recordedOrder < b.recordedOrder ? -1 : 1;
}

/**
 * The employee's manager on a day, from their dated history (owner decision 2026-11-15, ADR 0048):
 * the row in force is the one with the latest `effectiveFrom` on or before the day (a
 * since-records-began row comes before every dated one), and on a tie the later recorded row.
 * A day before the employee's first row reads that first row, the earliest manager on record.
 * An employee with no rows at all reads `current`, today's manager, which is how overrides were
 * worked out before the history existed, so nothing recorded earlier changes.
 */
export function managerOn(
  history: readonly ManagerHistoryRow[],
  employeeId: string,
  date: string,
  current: string | null,
): string | null {
  const rows = history.filter((row) => row.employeeId === employeeId).sort(byEffectiveDay);
  if (rows.length === 0) return current;
  const inForce = rows.filter((row) => row.effectiveFrom === null || row.effectiveFrom <= date).at(-1);
  return (inForce ?? rows[0]!).managerId;
}
