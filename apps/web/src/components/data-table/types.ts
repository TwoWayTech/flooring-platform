import type { ReactNode } from "react";
import type { FilterKind, NumberKind } from "@workspace/shared";

/** One column of a DataTable. */
export interface ColumnSpec<T> {
  id: string;
  header: string;
  /** The stored value, used to sort, search and export; numbers keep full precision in CSV. */
  value: (row: T) => string | number | null;
  /** Custom cell. Without it, numeric columns render through <Num> and others as text. */
  cell?: (row: T, ctx: { delta: number }) => ReactNode;
  /** Makes the column numeric: right-aligned, formatted, and offered More/Fewer decimals. */
  kind?: NumberKind;
  unit?: string;
  /** Starts hidden; people can show it again from the Columns menu. */
  hidden?: boolean;
  /** Fixed narrow columns such as a gauge; skipped by search, filters and CSV. */
  visualOnly?: boolean;
  /**
   * The column's filter (spec A2). Left out, it is chosen from the values: a range for numbers and
   * dates, a multi-select for few repeating values, otherwise text contains. False turns it off.
   */
  filter?: FilterKind | false;
  /** Sums the column over the filtered rows in a totals row; for money columns where a sum means something. */
  total?: boolean;
  className?: string;
  /**
   * The zone a row's wall times with no mark belong to, for the CSV's offset (ADR 0064). Left out,
   * they are the company's clock (DemoStore's stamps); a column of meeting times names the meeting's
   * own `timeZone`, so a meeting in another zone exports with its own offset. No table lists meeting
   * times today.
   */
  timeZone?: (row: T) => string;
}

/** Per-person table preferences, kept in this browser (design brief "Tables"). */
export interface TablePrefs {
  /** Decimals added to or removed from a column's number kind. */
  deltas: Record<string, number>;
  hidden: string[];
}
