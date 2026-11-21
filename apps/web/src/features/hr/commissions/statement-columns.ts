import { dec, moneyString } from "@workspace/shared";
import type { CommissionStatementRow } from "@/lib/api/contract";

/** One money column of the Statements list: its id, header and the decimal string it shows. */
export interface StatementFigureColumn {
  id: string;
  header: string;
  value: (row: CommissionStatementRow) => string;
}

const OVERRIDES: StatementFigureColumn = { id: "override", header: "Overrides", value: (r) => r.override };
const ADJUSTMENTS: StatementFigureColumn = { id: "adjustment", header: "Adjustments", value: (r) => r.adjustment };
/** What earlier months carried in, shown as the deduction it is, so the row adds up. */
const CARRIED_IN: StatementFigureColumn = {
  id: "carryIn",
  header: "Carried in",
  value: (r) => moneyString(dec(r.carryIn).negated()),
};
const DRAW: StatementFigureColumn = { id: "draw", header: "Draw", value: (r) => r.draw };

const nonZero = (rows: readonly CommissionStatementRow[], value: (row: CommissionStatementRow) => string) =>
  rows.some((r) => !dec(value(r)).isZero());

/**
 * The money columns of the Statements list for a month's rows (commissions.md rule 11,
 * `statementChain`; click-through #49). Each row reads as its sum: Earned + Overrides + Reversals
 * + Adjustments + Carried in = Net, and Payable is Net, or the Draw when the draw is larger.
 * Reversals are already negative and Carried in is shown negative. Overrides and Reversals always
 * show, because a manager's override is often the whole of their payable; Adjustments, Carried in
 * and Draw show only when some row in the month has one, so the usual table stays narrow.
 */
export function statementFigureColumns(rows: readonly CommissionStatementRow[]): StatementFigureColumn[] {
  return [
    { id: "earned", header: "Earned", value: (r) => r.earned },
    OVERRIDES,
    { id: "reversal", header: "Reversals", value: (r) => r.reversal },
    ...[ADJUSTMENTS, CARRIED_IN, DRAW].filter((c) => nonZero(rows, c.value)),
    { id: "payable", header: "Payable", value: (r) => r.payable },
  ];
}
