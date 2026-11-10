import {
  IMPORT_HANDLERS,
  importKind,
  importKindsFor,
  mappingProblems,
  MAX_IMPORT_ROWS,
  nextNumber,
  planImport,
  type ColumnMapping,
  type CompanyId,
  type ImportBatch,
  type ImportChange,
  type ImportCollection,
  type ImportCounts,
  type ImportKind,
  type ImportMapping,
  type ImportRequest,
  type ModuleKey,
} from "@workspace/shared";
import type { AuditInput, ImportOverview, ImportPreview, ImportResult } from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { CompanyDb } from "./company-db";

/**
 * What an import action needs (spec G1): the company, who imports (a company user, or the
 * platform admin from Platform admin → Company), and the company's modules, which decide the
 * kinds it may import.
 */
export interface ImportScope {
  db: CompanyDb;
  today: string;
  now: string;
  actor: { userId: string | null; name: string };
  modules: readonly ModuleKey[];
  newId: (kind: string) => string;
  audit: (entry: AuditInput) => void;
}

/** Collections an imported record may be referred to from, for the Undo check. */
const REFERRING = [
  "customers",
  "products",
  "rolls",
  "stockMovements",
  "quotes",
  "invoices",
  "payments",
  "invoiceAdjustments",
  "refunds",
  "reservations",
  "stockAdjustments",
  "transfers",
  "purchaseOrders",
  "receipts",
  "bills",
  "supplierPayments",
  "jobs",
  "meetings",
  "employees",
  "timesheets",
  "ptoRequests",
] as const;

const countsText = (c: ImportCounts) =>
  `${c.create} created, ${c.update} updated, ${c.skip} skipped, ${c.error} with errors`;

/** The kinds, saved mappings and history the wizard shows. */
export function importOverview(scope: ImportScope): ImportOverview {
  return {
    kinds: importKindsFor(scope.modules),
    mappings: scope.db.list("importMappings"),
    batches: [...scope.db.list("importBatches")].reverse(),
  };
}

/** The checks every request passes: a kind the company has, a mapping with its required columns, and the demo's row limit. */
function checkRequest(scope: ImportScope, request: ImportRequest) {
  if (!importKindsFor(scope.modules).includes(request.kind)) {
    throw new DemoRuleError("This company does not have the module for this import.");
  }
  const problems = mappingProblems(importKind(request.kind), request.mapping);
  if (problems.length) throw new DemoRuleError(problems[0]!);
  if (request.table.rows.length > MAX_IMPORT_ROWS) {
    throw new DemoRuleError(
      `This file has ${request.table.rows.length} rows. The demo imports up to ${MAX_IMPORT_ROWS} at a time; split the file.`,
    );
  }
}

/** Plans the request against the company's records as they are now (never the screen's copy). */
function plan(scope: ImportScope, request: ImportRequest, batch: { id: string; number: string }) {
  const { db } = scope;
  return planImport(IMPORT_HANDLERS[request.kind], request, {
    world: {
      customers: db.list("customers"),
      suppliers: db.list("suppliers"),
      supplierContacts: db.list("supplierContacts"),
      products: db.list("products"),
      rolls: db.list("rolls"),
      stockMovements: db.list("stockMovements"),
      invoices: db.list("invoices"),
      bills: db.list("bills"),
      employees: db.list("employees"),
      locations: db.list("locations"),
      users: db.list("users"),
      payments: db.list("payments"),
      invoiceAdjustments: db.list("invoiceAdjustments"),
      supplierPayments: db.list("supplierPayments"),
      reservations: db.list("reservations"),
    },
    companyId: db.companyId as CompanyId,
    today: scope.today,
    now: scope.now,
    actorId: scope.actor.userId,
    batch,
    newId: scope.newId,
  });
}

/** The dry run (spec G1 step 6): what each row would do, without writing anything. */
export function previewImport(scope: ImportScope, request: ImportRequest): ImportPreview {
  checkRequest(scope, request);
  const { rows, counts } = plan(scope, request, { id: "preview", number: "this import" });
  return { rows, counts };
}

/**
 * Imports the valid rows (spec G1 step 7) and keeps the batch for the history and Undo. Rows
 * with errors are left out and come back for the error report.
 */
export function runImport(scope: ImportScope, request: ImportRequest): ImportResult {
  checkRequest(scope, request);
  const { db } = scope;
  const id = scope.newId("imp");
  const number = nextNumber(
    "IMP-",
    db.list("importBatches").map((b) => b.number),
    1001,
  );
  const result = plan(scope, request, { id, number });
  if (result.counts.create + result.counts.update === 0) {
    throw new DemoRuleError("Nothing to import: every row is skipped or has errors.");
  }
  for (const change of result.changes) db.put(change.collection, change.after as never);
  const batch: ImportBatch = {
    id,
    number,
    kind: request.kind,
    fileName: request.fileName,
    at: scope.now,
    byName: scope.actor.name,
    mapping: request.mapping,
    counts: result.counts,
    changes: result.changes,
    undoneAt: null,
    undoneBy: null,
  };
  db.put("importBatches", batch);
  scope.audit({
    category: "data",
    action: `Imported ${importKind(request.kind).label.toLowerCase()}`,
    target: `${number}, ${request.fileName}`,
    before: null,
    after: countsText(result.counts),
  });
  return { batch, rows: result.rows };
}

/** What stops an Undo: a record changed since the import, or a new record now used elsewhere. */
function undoProblem(db: CompanyDb, changes: readonly ImportChange[]): string | null {
  for (const change of changes) {
    const now = db.get(change.collection, change.id);
    if (JSON.stringify(now) !== JSON.stringify(change.after)) {
      return `${recordName(change)} changed after the import, so the import cannot be undone.`;
    }
  }
  const mine = new Set(changes.map((c) => c.id));
  const created = changes.filter((c) => c.before === null);
  for (const name of REFERRING) {
    const others = JSON.stringify((db.list(name) as { id: string }[]).filter((r) => !mine.has(r.id)));
    const used = created.find((c) => others.includes(`"${c.id}"`));
    if (used) return `${recordName(used)} is already used by other records, so the import cannot be undone.`;
  }
  return null;
}

/** A readable name for a changed record in an Undo message. */
function recordName(change: ImportChange): string {
  const r = change.after as { name?: string; sku?: string; number?: string; rollNumber?: string };
  return r.name ?? r.sku ?? r.number ?? r.rollNumber ?? "A record";
}

/**
 * Undoes one import (spec G1 step 8): records it created are removed and records it updated go
 * back to their earlier version. It is refused when any of them changed since, or when a new
 * record is already used elsewhere (a quote for an imported customer, a cut from an imported roll).
 */
export function undoImport(scope: ImportScope, batchId: string): ImportBatch {
  const { db } = scope;
  const batch = db.get("importBatches", batchId);
  if (!batch) throw new DemoRuleError("This import no longer exists.");
  if (batch.undoneAt) throw new DemoRuleError(`${batch.number} was already undone.`);
  const problem = undoProblem(db, batch.changes);
  if (problem) throw new DemoRuleError(problem);
  for (const change of batch.changes) {
    if (change.before === null) db.remove(change.collection, change.id);
    else db.put(change.collection as ImportCollection, change.before as never);
  }
  const undone = { ...batch, undoneAt: scope.now, undoneBy: scope.actor.name };
  db.put("importBatches", undone);
  scope.audit({
    category: "data",
    action: "Undid import",
    target: `${batch.number}, ${batch.fileName}`,
    before: countsText(batch.counts),
    after: "records put back as before the import",
  });
  return undone;
}

/** Saves the column mapping for the next file of this kind (spec G1 step 4). */
export function saveImportMapping(scope: ImportScope, kind: ImportKind, columns: ColumnMapping): ImportMapping {
  const mapping: ImportMapping = {
    id: `${scope.db.companyId}-map-${kind}`,
    kind,
    columns,
    savedAt: scope.now,
    savedBy: scope.actor.name,
  };
  return scope.db.put("importMappings", mapping);
}
