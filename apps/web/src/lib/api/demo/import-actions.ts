import {
  batchSummary,
  countsText,
  IMPORT_HANDLERS,
  IMPORT_WORDS,
  importAuditAction,
  importKind,
  importKindRefusal,
  importKindsOpen,
  importRequestProblem,
  mappingFor,
  nextNumber,
  planActions,
  planImport,
  productUndoProblem,
  recordName,
  sameRecord,
  sensitiveColumnRefusal,
  type ColumnMapping,
  type CompanyId,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportChange,
  type ImportCollection,
  type ImportHolder,
  type ImportKind,
  type ImportKindDef,
  type ImportMapping,
  type ImportOverview,
  type ImportPreview,
  type ImportRefusal,
  type ImportRequest,
  type ImportResult,
  type ModuleKey,
} from "@workspace/shared";
import type { AuditInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { CompanyDb } from "./company-db";

/**
 * What an import action needs (spec G1): the company, who imports (a company user, or the
 * platform admin from Platform admin → Company), the company's modules, and the importer's
 * effective keys and data scope, which decide the kinds and columns they may import (ADR 0057
 * S-2 to S-4, the same shared rules the API applies).
 */
export interface ImportScope {
  db: CompanyDb;
  today: string;
  now: string;
  actor: { userId: string | null; name: string };
  modules: readonly ModuleKey[];
  holder: ImportHolder;
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

/** Throws a shared refusal with the words the API answers it with (ADR 0057). */
function refuse(refusal: ImportRefusal | null): void {
  if (refusal) throw new DemoRuleError(refusal.message);
}

/**
 * The kind's fields with their chosen header or null (ADR 0057 S-17): a choice naming a field the
 * kind doesn't have is refused, as on the API.
 */
function columnsFor(def: ImportKindDef, columns: ColumnMapping): ColumnMapping {
  const mapping = mappingFor(def, columns);
  if ("problem" in mapping) throw new DemoRuleError((mapping as { problem: string }).problem);
  return mapping;
}

/** The kinds this person may import, their saved mappings and history (newest first, without the saved records). */
export function importOverview(scope: ImportScope): ImportOverview {
  return {
    kinds: importKindsOpen(scope.modules, scope.holder),
    mappings: scope.db.list("importMappings"),
    batches: [...scope.db.list("importBatches")].reverse().map(batchSummary),
  };
}

/**
 * The checks every request passes, in the API's order (ADR 0057, api 4.4): the kind is open to
 * this person (module, switch, data scope, the kind's own keys), the column choices name only the
 * kind's fields, the mapping and size are within the limits, and every sensitive column chosen is
 * one the person may see. Returns the request with the kind's full mapping.
 */
function checkRequest(scope: ImportScope, request: ImportRequest): ImportRequest {
  refuse(importKindRefusal(request.kind, scope.modules, scope.holder));
  const def = importKind(request.kind);
  const checked = { ...request, mapping: columnsFor(def, request.mapping) };
  const problem = importRequestProblem(def, checked);
  if (problem) throw new DemoRuleError(problem);
  refuse(sensitiveColumnRefusal(request.kind, checked.mapping, scope.holder));
  return checked;
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
      timesheets: db.list("timesheets"),
      timeOffEntries: db.list("timeOffEntries"),
      timeOffPolicies: db.list("timeOffPolicies"),
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
    workweekStartDay: db.settings.hr.workweekStartDay,
  });
}

/** The dry run (spec G1 step 6): what each row would do, without writing anything. */
export function previewImport(scope: ImportScope, request: ImportRequest): ImportPreview {
  const checked = checkRequest(scope, request);
  const { rows, counts } = plan(scope, checked, { id: "preview", number: "this import" });
  return { rows, counts };
}

/**
 * Imports the valid rows (spec G1 step 7) and keeps the batch for the history and Undo. Rows
 * with errors are left out and come back for the error report. When the request carries the dry
 * run's actions, the import is refused unless every row would still do what the person checked
 * (ADR 0057 S-10).
 */
export function runImport(scope: ImportScope, request: ImportRequest): ImportResult {
  const checked = checkRequest(scope, request);
  const { db } = scope;
  const id = scope.newId("imp");
  const number = nextNumber(
    "IMP-",
    db.list("importBatches").map((b) => b.number),
    1001,
  );
  const result = plan(scope, checked, { id, number });
  if (request.expected !== undefined && request.expected !== planActions(result.rows)) {
    throw new DemoRuleError(IMPORT_WORDS.planChanged);
  }
  if (result.counts.create + result.counts.update === 0) throw new DemoRuleError(IMPORT_WORDS.nothing);
  for (const change of result.changes) db.put(change.collection, change.after as never);
  const batch: ImportBatch = {
    id,
    number,
    kind: request.kind,
    fileName: request.fileName,
    at: scope.now,
    byName: scope.actor.name,
    mapping: checked.mapping,
    counts: result.counts,
    changes: result.changes,
    undoneAt: null,
    undoneBy: null,
  };
  db.put("importBatches", batch);
  scope.audit({
    category: "data",
    action: importAuditAction(request.kind),
    target: `${number}, ${request.fileName}`,
    before: null,
    after: countsText(result.counts),
  });
  return { batch: batchSummary(batch), rows: result.rows };
}

/** Product ids with any stock movement or roll in the demo's records (ADR 0057 S-5). */
function productsWithStock(db: CompanyDb): ReadonlySet<string> {
  return new Set([...db.list("stockMovements"), ...db.list("rolls")].map((r) => r.productId));
}

/**
 * What stops an Undo (ADR 0057 S-14), in the API's order: a record that no longer equals what the
 * import wrote (compared by content, key order aside), a product the import changed that has
 * stock history now or whose earlier supplier is gone, or a created record now used elsewhere.
 */
function undoProblem(db: CompanyDb, changes: readonly ImportChange[]): string | null {
  for (const change of changes) {
    if (!sameRecord(db.get(change.collection, change.id), change.after)) {
      return IMPORT_WORDS.changed(recordName(change));
    }
  }
  const withStock = productsWithStock(db);
  const facts = {
    hasStock: (productId: string) => withStock.has(productId),
    supplierLive: (supplierId: string) => db.get("suppliers", supplierId) !== undefined,
  };
  for (const change of changes) {
    const problem = productUndoProblem(change, facts);
    if (problem) return problem;
  }
  const mine = new Set(changes.map((c) => c.id));
  const created = changes.filter((c) => c.before === null);
  for (const name of REFERRING) {
    const others = JSON.stringify((db.list(name) as { id: string }[]).filter((r) => !mine.has(r.id)));
    const used = created.find((c) => others.includes(`"${c.id}"`));
    if (used) return IMPORT_WORDS.inUse(recordName(used));
  }
  return null;
}

/**
 * Undoes one import (spec G1 step 8): records it created are removed and records it updated go
 * back to their earlier version. Undo puts sensitive values back, so it needs the access the
 * import needed (ADR 0057 S-3, S-4). It is refused when any record changed since, when a product
 * can't be put back (stock history, a removed supplier), or when a new record is already used
 * elsewhere (a quote for an imported customer, a cut from an imported roll).
 */
export function undoImport(scope: ImportScope, batchId: string): ImportBatchSummary {
  const { db } = scope;
  const batch = db.get("importBatches", batchId);
  if (!batch) throw new DemoRuleError(IMPORT_WORDS.gone);
  if (batch.undoneAt) throw new DemoRuleError(IMPORT_WORDS.alreadyUndone(batch.number));
  refuse(importKindRefusal(batch.kind, scope.modules, scope.holder));
  refuse(sensitiveColumnRefusal(batch.kind, batch.mapping, scope.holder));
  const problem = undoProblem(db, batch.changes);
  if (problem) throw new DemoRuleError(problem);
  for (const change of batch.changes) {
    if (change.before === null) db.remove(change.collection, change.id);
    else db.put(change.collection as ImportCollection, change.before as never);
  }
  const undone: ImportBatch = { ...batch, undoneAt: scope.now, undoneBy: scope.actor.name };
  db.put("importBatches", undone);
  scope.audit({
    category: "data",
    action: "Undid import",
    target: `${batch.number}, ${batch.fileName}`,
    before: countsText(batch.counts),
    after: IMPORT_WORDS.undoneAfter,
  });
  return batchSummary(undone);
}

/** The chosen columns as the audit log words them: "Name ← Customer Name; Email ← E-mail". */
function columnsText(def: ImportKindDef, columns: ColumnMapping): string {
  const chosen = def.fields.filter((f) => columns[f.key]).map((f) => `${f.label} ← ${columns[f.key]}`);
  return chosen.length ? chosen.join("; ") : "No columns";
}

/**
 * Saves the column mapping for the next file of this kind (spec G1 step 4). The kind must be open
 * to the person, but saving header names needs no sensitive key; the save is audited, as every
 * change of a record is (CLAUDE.md rule 10; ADR 0057 S-13).
 */
export function saveImportMapping(scope: ImportScope, kind: ImportKind, columns: ColumnMapping): ImportMapping {
  refuse(importKindRefusal(kind, scope.modules, scope.holder));
  const def = importKind(kind);
  const mapping: ImportMapping = {
    id: `${scope.db.companyId}-map-${kind}`,
    kind,
    columns: columnsFor(def, columns),
    savedAt: scope.now,
  };
  const before = scope.db.get("importMappings", mapping.id);
  scope.db.put("importMappings", mapping);
  scope.audit({
    category: "data",
    action: "Saved import columns",
    target: def.label,
    before: before ? columnsText(def, before.columns) : null,
    after: columnsText(def, mapping.columns),
  });
  return mapping;
}
