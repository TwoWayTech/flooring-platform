/** A payment in the queue, as far as who may verify it goes. */
interface Recorded {
  recordedById: string;
}

/** The label on a payment the viewer recorded: they may not verify it themselves (two-person check). */
export const OWN_PAYMENT_LABEL = "You recorded it. Someone else verifies it";

/** Whether the viewer recorded this payment, so someone else must verify it. */
export function recordedByViewer(row: Recorded, userId: string): boolean {
  return row.recordedById === userId;
}

/**
 * The line above Payments to verify (click-through #36): how many this person can check, and, when
 * some are their own, how many wait for someone else, so the count matches the rows listed for
 * every role.
 */
export function queueSummary(rows: readonly Recorded[], userId: string): string {
  const own = rows.filter((row) => recordedByViewer(row, userId)).length;
  const toCheck = rows.length - own;
  const mine = own === 0 ? "" : ` ${own} you recorded ${own === 1 ? "waits" : "wait"} for someone else to verify.`;
  return `${toCheck} waiting for you to check.${mine}`;
}
