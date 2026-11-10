import type {
  Bill,
  CompanyId,
  Customer,
  Employee,
  Invoice,
  InvoiceAdjustment,
  Location,
  Payment,
  Product,
  Reservation,
  Roll,
  StockMovement,
  Supplier,
  SupplierContact,
  SupplierPayment,
  User,
} from "../types";
import { readCell, type ImportCellValue } from "./fields";
import type {
  CellProblem,
  ImportChange,
  ImportCollection,
  ImportCounts,
  ImportKindDef,
  ImportPlan,
  ImportRequest,
  PlannedRow,
} from "./types";

/** The company's records an import reads and writes; the plan works on a copy. */
export interface ImportWorld {
  customers: Customer[];
  suppliers: Supplier[];
  supplierContacts: SupplierContact[];
  products: Product[];
  rolls: Roll[];
  stockMovements: StockMovement[];
  invoices: Invoice[];
  bills: Bill[];
  employees: Employee[];
  locations: readonly Location[];
  users: readonly User[];
  payments: readonly Payment[];
  invoiceAdjustments: readonly InvoiceAdjustment[];
  supplierPayments: readonly SupplierPayment[];
  reservations: readonly Reservation[];
}

/** Who imports, when, and the ids the plan may hand out. */
export interface PlanContext {
  world: ImportWorld;
  companyId: CompanyId;
  today: string;
  now: string;
  /** The importing user's id, or null for the platform admin. */
  actorId: string | null;
  batch: { id: string; number: string };
  newId: (kind: string) => string;
}

/** A row's cells read by type, by field key; null where the cell is empty. */
export type ParsedRow = Record<string, ImportCellValue | null>;

/** One record a row writes. */
export interface RowWrite {
  collection: ImportCollection;
  record: { id: string };
}

/** What a kind decides for one valid row: problems found against the data, or what to write. */
export type RowOutcome =
  | { problems: CellProblem[] }
  | { action: "create" | "update" | "skip"; label: string; writes: RowWrite[]; note?: string };

/** The rules of one import kind (kinds/*.ts). */
export interface KindHandler {
  def: ImportKindDef;
  /** The field that names a row in the preview, such as the name or SKU. */
  labelField: string;
  /** What two rows of one file may not share (spec G1 "duplicates"), or null when repeats are fine. */
  duplicateKey: (row: ParsedRow) => string | null;
  resolve: (row: ParsedRow, ctx: PlanContext) => RowOutcome;
}

/**
 * The demo's row limit for one import: the overlay lives in browser storage. A real import runs
 * on the server without it.
 */
export const MAX_IMPORT_ROWS = 2000;

const EMPTY_COUNTS = (): ImportCounts => ({ create: 0, update: 0, skip: 0, error: 0 });

/** The cells of each non-blank data row, by field key, with its row number in the file. */
function readRows(def: ImportKindDef, request: ImportRequest) {
  const index = new Map(request.table.headers.map((h, i) => [h, i]));
  return request.table.rows
    .map((cells, i) => ({ line: i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim() !== ""))
    .map(({ line, cells }) => {
      const byField: Record<string, string> = {};
      for (const field of def.fields) {
        const header = request.mapping[field.key];
        byField[field.key] = header && index.has(header) ? (cells[index.get(header)!] ?? "").trim() : "";
      }
      return { line, cells: byField };
    });
}

/** Reads every cell of a row by its type; problems name the field. */
function parseRow(def: ImportKindDef, cells: Record<string, string>) {
  const values: ParsedRow = {};
  const problems: CellProblem[] = [];
  for (const field of def.fields) {
    const result = readCell(field, cells[field.key] ?? "");
    if ("error" in result) problems.push({ field: field.key, message: result.error });
    else values[field.key] = result.value;
  }
  return { values, problems };
}

/** Puts a written record into the working copy, so later rows of the file see it. */
function applyWrite(world: ImportWorld, write: RowWrite) {
  const list = world[write.collection] as { id: string }[];
  const at = list.findIndex((r) => r.id === write.record.id);
  if (at >= 0) list[at] = write.record;
  else list.push(write.record);
}

/** A copy of the writable collections, so planning never changes the caller's data. */
function workingCopy(world: ImportWorld): ImportWorld {
  return {
    ...world,
    customers: [...world.customers],
    suppliers: [...world.suppliers],
    products: [...world.products],
    rolls: [...world.rolls],
    stockMovements: [...world.stockMovements],
    invoices: [...world.invoices],
    bills: [...world.bills],
    employees: [...world.employees],
  };
}

/**
 * The dry run (spec G1 steps 5 and 6): reads each row by type, flags repeats within the file,
 * then lets the kind match it against the company's records (on external ID, SKU or email) to
 * create, update or skip it. Rows are planned in order on a working copy, so two addresses for
 * one customer build on each other. The result lists every change with the version it replaces,
 * which is what Undo puts back.
 */
export function planImport(handler: KindHandler, request: ImportRequest, ctx: PlanContext): ImportPlan {
  const world = workingCopy(ctx.world);
  const context = { ...ctx, world };
  const rows: PlannedRow[] = [];
  const counts = EMPTY_COUNTS();
  const firstSeen = new Map<string, number>();
  const changes = new Map<string, ImportChange>();
  for (const { line, cells } of readRows(handler.def, request)) {
    const { values, problems } = parseRow(handler.def, cells);
    const label = cells[handler.labelField] || `Row ${line}`;
    const key = problems.length === 0 ? handler.duplicateKey(values) : null;
    if (key && firstSeen.has(key)) {
      problems.push({ field: null, message: `Repeats row ${firstSeen.get(key)}; each record once per file.` });
    } else if (key) firstSeen.set(key, line);
    const outcome: RowOutcome = problems.length ? { problems } : handler.resolve(values, context);
    if ("problems" in outcome) {
      rows.push({ line, action: "error", label, cells, problems: outcome.problems, note: null });
      counts.error += 1;
      continue;
    }
    for (const write of outcome.writes) {
      const id = `${write.collection}:${write.record.id}`;
      const before =
        changes.get(id)?.before ??
        (world[write.collection] as { id: string }[]).find((r) => r.id === write.record.id) ??
        null;
      changes.set(id, { collection: write.collection, id: write.record.id, before, after: write.record });
      applyWrite(world, write);
    }
    rows.push({ line, action: outcome.action, label: outcome.label, cells, problems: [], note: outcome.note ?? null });
    counts[outcome.action] += 1;
  }
  return { rows, counts, changes: [...changes.values()] };
}

/** "Creates 12, updates 3, skips 1; 2 rows have errors" (spec G1 dry run). */
export function dryRunSummary(counts: ImportCounts): string {
  const done = `Creates ${counts.create}, updates ${counts.update}, skips ${counts.skip}`;
  if (counts.error === 0) return `${done}.`;
  return `${done}; ${counts.error} ${counts.error === 1 ? "row has errors and is" : "rows have errors and are"} left out.`;
}
