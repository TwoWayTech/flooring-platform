import type { ModuleKey } from "../products";
import type { User } from "../types";

/** What the import wizard can bring in (spec G1). */
export type ImportKind =
  "customers" | "addresses" | "suppliers" | "products" | "stock" | "invoices" | "bills" | "employees" | "timesheets";

/**
 * How a cell is read (spec G1 "Validate"): plain text, an email, money with at most two decimals,
 * a number (optionally with its unit, such as "12 ft"), a whole number, a date, yes or no, one
 * value from a list, or several values separated by semicolons.
 */
export type FieldType = "text" | "email" | "money" | "number" | "integer" | "date" | "bool" | "choice" | "list";

/** One column an import kind understands. */
export interface ImportField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Other header names that auto-match this field, lower case. */
  aliases?: readonly string[];
  /** For choice and list fields: the stored value and the label people type. */
  choices?: Readonly<Record<string, string>>;
  /** For number fields: the unit a value may carry, such as "ft" in "12 ft". */
  unit?: "ft" | "sq ft";
  /** What the template shows in its two example rows. */
  examples: readonly [string, string];
  /** The most characters a cell may hold after trimming: the module's own limit (ADR 0057 S-12). */
  maxLength?: number;
  /** Number and integer fields: the most whole digits and decimals the column stores (ADR 0057 S-12, M3). */
  digits?: { whole: number; decimals: number };
  /** A number must be more than 0, such as a carton's coverage or a roll's width (ADR 0057 S-18). */
  positive?: true;
  /** The cell may hold tab and line breaks; every other field refuses control characters (ADR 0057 S-17). */
  multiline?: true;
}

/** A kind of import and the columns it reads. */
export interface ImportKindDef {
  kind: ImportKind;
  label: string;
  description: string;
  /** The module the records belong to; the kind is offered only while it is on. */
  module: ModuleKey;
  /** How a row finds the record it updates, in words for the screen. */
  matchOn: string;
  fields: readonly ImportField[];
}

/** For each field, the header in the file it reads from, or null when the file has none. */
export type ColumnMapping = Record<string, string | null>;

/** A parsed file: the header row and the data rows, every cell as text. */
export interface ImportTable {
  headers: string[];
  rows: string[][];
}

/** One thing wrong with a row; `field` is null when the row as a whole is the problem. */
export interface CellProblem {
  field: string | null;
  message: string;
}

/** What importing a row does. */
export type RowAction = "create" | "update" | "skip" | "error";

/** One row of the dry run (spec G1 "Preview", "dry run"). */
export interface PlannedRow {
  /** The row number in the file, counting the header as row 1. */
  line: number;
  action: RowAction;
  /** A name for the record, such as the customer's name or the SKU. */
  label: string;
  /** The row's cells by field key, as typed. */
  cells: Record<string, string>;
  problems: CellProblem[];
  /** Why the row is skipped or what an update leaves alone. */
  note: string | null;
}

/** Collections an import writes. */
export type ImportCollection =
  | "timesheets"
  | "timeOffEntries"
  | "customers"
  | "suppliers"
  | "supplierContacts"
  | "products"
  | "rolls"
  | "stockMovements"
  | "invoices"
  | "bills"
  | "employees";

/** One record an import creates or changes, with the version before it (null when created). */
export interface ImportChange {
  collection: ImportCollection;
  id: string;
  before: unknown;
  after: unknown;
}

/** How many rows do what. */
export type ImportCounts = Record<RowAction, number>;

/** The dry run: every row with its action, and the records importing would write. */
export interface ImportPlan {
  rows: PlannedRow[];
  counts: ImportCounts;
  changes: ImportChange[];
}

/** What the wizard sends to check or import a file. */
export interface ImportRequest {
  kind: ImportKind;
  fileName: string;
  table: ImportTable;
  mapping: ColumnMapping;
  /**
   * The dry run's action per row (`planActions`, such as "ccse"). The import is refused when the
   * records changed so that a row would now do something else (ADR 0057 S-10). The API requires it.
   */
  expected?: string;
}

/**
 * One import, kept for the history and for Undo (spec G1 "Import history with Undo"): the
 * records it created and the versions it replaced.
 */
export interface ImportBatch {
  id: string;
  /** IMP-0001. */
  number: string;
  kind: ImportKind;
  fileName: string;
  at: string;
  byName: string;
  mapping: ColumnMapping;
  counts: ImportCounts;
  changes: ImportChange[];
  undoneAt: string | null;
  undoneBy: string | null;
}

/**
 * An import as the history shows it: everything but the saved record versions, which never leave
 * the store or the database (ADR 0057 S-15).
 */
export type ImportBatchSummary = Omit<ImportBatch, "changes">;

/** A column mapping saved for the next file of the same kind (spec G1 "save the mapping"). */
export interface ImportMapping {
  id: string;
  kind: ImportKind;
  columns: ColumnMapping;
  savedAt: string;
}

/**
 * A company member an import may name, such as a customer's sales rep. The API reads them from
 * the company's members; `branchId` is set only by the demo, for its opening invoices.
 */
export type ImportUser = Pick<User, "id" | "name" | "email" | "status"> & { branchId?: string };

/** What the wizard opens with: the kinds the person may import, saved mappings and the history. */
export interface ImportOverview {
  kinds: ImportKind[];
  mappings: ImportMapping[];
  batches: ImportBatchSummary[];
}

/** The dry run as the wizard shows it: what each row would do and the counts. */
export type ImportPreview = Pick<ImportPlan, "rows" | "counts">;

/** A finished import: the batch for the history and every row, for the error report. */
export interface ImportResult {
  batch: ImportBatchSummary;
  rows: PlannedRow[];
}
