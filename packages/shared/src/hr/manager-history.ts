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
  /**
   * The user who set this manager, for the self-made manager guard (`managerSelfSetOn`; ADR 0048
   * "Self-made manager"): who saved a dated row, or for a since-records-began row whoever made the
   * last manager change before the history began. Null or absent when nobody is known.
   */
  setBy?: string | null;
}

/** Earliest first: since-records-began rows, then by day, then by when they were recorded. */
function byEffectiveDay(a: ManagerHistoryRow, b: ManagerHistoryRow): number {
  const day = (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? "");
  if (day !== 0) return day;
  if (a.recordedOrder === b.recordedOrder) return 0;
  return a.recordedOrder < b.recordedOrder ? -1 : 1;
}

/** One employee's rows, earliest first (`byEffectiveDay`). */
function rowsOf(history: readonly ManagerHistoryRow[], employeeId: string): ManagerHistoryRow[] {
  return history.filter((row) => row.employeeId === employeeId).sort(byEffectiveDay);
}

/**
 * The rows that were in force on at least one day: the last recorded row of each `effectiveFrom`
 * (a row overtaken later the same day never decided anyone's manager).
 */
function rowsInForce(rows: readonly ManagerHistoryRow[]): ManagerHistoryRow[] {
  return rows.filter((row, i) => i === rows.length - 1 || rows[i + 1]!.effectiveFrom !== row.effectiveFrom);
}

/**
 * The history row in force for an employee on a day (owner decision 2026-11-15, ADR 0048): the one
 * with the latest `effectiveFrom` on or before the day (a since-records-began row comes before
 * every dated one), and on a tie the later recorded row. A day before the employee's first row
 * reads that first row, the earliest manager on record. Null when the employee has no rows.
 */
export function managerRowOn(
  history: readonly ManagerHistoryRow[],
  employeeId: string,
  date: string,
): ManagerHistoryRow | null {
  const rows = rowsOf(history, employeeId);
  if (rows.length === 0) return null;
  return rows.filter((row) => row.effectiveFrom === null || row.effectiveFrom <= date).at(-1) ?? rows[0]!;
}

/**
 * The employee's manager on a day, from their dated history (`managerRowOn`). An employee with no
 * rows at all reads `current`, today's manager, which is how overrides were worked out before the
 * history existed, so nothing recorded earlier changes.
 */
export function managerOn(
  history: readonly ManagerHistoryRow[],
  employeeId: string,
  date: string,
  current: string | null,
): string | null {
  const row = managerRowOn(history, employeeId, date);
  return row ? row.managerId : current;
}

/**
 * Whether `userId` set the employee's manager in force on the day and nobody else has set that same
 * manager again since (ADR 0048 "Self-made manager"; second security review of PR #27, first review
 * of PR #32). The override on a sale goes to the manager on its day, so the row in force that day
 * decides, not the latest change: moving the person to another manager later leaves the earlier
 * days self-made. Someone else setting that same manager again later (in force on some day, not
 * overtaken the same day) confirms it, the earlier days included. False with no rows.
 */
export function managerSelfSetOn(
  history: readonly ManagerHistoryRow[],
  employeeId: string,
  date: string,
  userId: string,
): boolean {
  const inForce = managerRowOn(history, employeeId, date);
  if (!inForce || (inForce.setBy ?? null) !== userId) return false;
  const rows = rowsOf(history, employeeId);
  const later = rowsInForce(rows.slice(rows.indexOf(inForce) + 1));
  return !later.some((row) => row.managerId === inForce.managerId && (row.setBy ?? null) !== userId);
}
