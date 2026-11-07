import type { ReactNode } from "react";
import type { NumberKind } from "@workspace/shared";

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
  /** Fixed narrow columns such as a gauge; skipped by search and CSV. */
  visualOnly?: boolean;
  className?: string;
}

/** Per-person table preferences, kept in this browser (design brief "Tables"). */
export interface TablePrefs {
  /** Decimals added to or removed from a column's number kind. */
  deltas: Record<string, number>;
  hidden: string[];
}
