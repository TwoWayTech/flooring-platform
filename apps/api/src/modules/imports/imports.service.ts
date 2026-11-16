import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  emptyImportWorld,
  IMPORT_HANDLERS,
  IMPORT_WORDS,
  importKind,
  importRequestProblem,
  mappingFor,
  planActions,
  planImport,
  recordName,
  sameRecord,
  type ColumnMapping,
  type CompanyId,
  type ImportBatchSummary,
  type ImportChange,
  type ImportKind,
  type ImportKindDef,
  type ImportMapping,
  type ImportOverview,
  type ImportPlan,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
} from "@workspace/shared";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { minuteIn } from "../reports/report-records";
import { loadNames } from "../sales/invoice-records";
import { companyClock, type CompanyClock } from "../sales/sales-common";
import { openColumns, openKind, openKinds, type ImportAccess } from "./import-access";
import { batchEntry, mappingEntry, recordEntry, undoBatchEntry, undoRecordEntry } from "./import-audit";
import type { ImportCommitInput, ImportInput } from "./import-input";
import { importFailure, limitLockWait, takeImportLock } from "./import-lock";
import {
  batchesInLastDay,
  insertBatch,
  loadBatchSummaries,
  loadMappings,
  lockBatch,
  markUndone,
  nextBatchNumber,
  storedMapping,
  summaryOf,
  upsertMapping,
} from "./import-records";
import { firstReference, lockTargets } from "./import-references";
import { changeKey, type KindStore, type ReferenceTarget } from "./kind-store";

/** Committed imports a company may make in 24 hours (ADR 0057 S-12); dry runs don't count. */
const DAILY_IMPORTS = 50;

/**
 * The rows an Undo of `change` soft-deletes, which are the reference check's targets (ADR 0057 api
 * 4.8): the record when the import created it, and every part it created, such as a new address
 * on an updated customer.
 */
function createdRows(store: KindStore, change: ImportChange): ReferenceTarget[] {
  return [
    ...(change.before === null ? [{ table: store.record(change.collection).table, id: change.id }] : []),
    ...store.createdParts(change),
  ];
}

/** The batch a dry run plans under: nothing is numbered or kept. */
const PREVIEW = { id: "preview", number: "this import" };

/** A request the import rules refuse: 400 `invalid_request` with the rule's own words. */
function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/** A 409 with its code and words (ADR 0057 api 4.11). */
function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/** The kind's full mapping from the request's column choices, or a 400 naming a field the kind doesn't have. */
function mappingOf(def: ImportKindDef, columns: Readonly<ColumnMapping>): ColumnMapping {
  const mapping = mappingFor(def, columns);
  // A mapping holds only the kind's field keys, and no kind has a field named "problem".
  if ("problem" in mapping && typeof mapping.problem === "string") throw refuse(mapping.problem);
  return mapping as ColumnMapping;
}

/**
 * The checks every dry run and import passes before any database work, in the API's order (ADR
 * 0057 api 4.4 steps 4 to 6): the kind is open to the person (part 1, module, switch, data scope,
 * the kind's keys), the column choices name only the kind's fields, the mapping and size are
 * within the limits, and every sensitive column chosen is one the person may see.
 */
function admit(access: ImportAccess, input: ImportInput): { store: KindStore; request: ImportRequest } {
  const store = openKind(access, input.kind);
  const def = importKind(input.kind);
  const request: ImportRequest = {
    kind: input.kind,
    fileName: input.fileName,
    table: input.table,
    mapping: mappingOf(def, input.mapping),
  };
  const problem = importRequestProblem(def, request);
  if (problem) throw refuse(problem);
  openColumns(access, input.kind, request.mapping);
  return { store, request };
}

/** Who plans and when: the company, the importer and the company's clock. */
interface PlanRun {
  tenant: TenantContext;
  actorId: string;
  clock: CompanyClock;
}

/**
 * Data import on the API, part 1 (docs/product-spec/import.md; ADR 0057): customers, customer
 * addresses, suppliers and products. The browser parses the file and sends only the chosen
 * columns; the plan is the same shared one the demo runs, made here against the company's records
 * as their modules load them. An import re-plans under the import lock and table locks and is
 * refused unless every row would do what the dry run showed; all valid rows commit in one
 * transaction with an audit entry per record and one for the batch. Undo is exact or refused.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * What the wizard opens with (ADR 0057 api 4.2): the kinds the person may import here, the saved
   * column choices of those kinds, and the latest 200 imports without their saved records.
   */
  async overview(tenant: TenantContext, access: RequestAccess): Promise<ImportOverview> {
    const db = await this.tenancy.db(tenant);
    const kinds = openKinds(access);
    const [mappings, batches] = await Promise.all([loadMappings(db), loadBatchSummaries(db, this.control.db)]);
    return { kinds, mappings: mappings.filter((mapping) => kinds.includes(mapping.kind)), batches };
  }

  /**
   * The dry run (spec G1 step 6): what each row would do, in one read-only snapshot, writing
   * nothing and auditing nothing. It waits for no other import: one running answers 409.
   */
  async check(tenant: TenantContext, actor: Actor, input: ImportInput): Promise<ImportPreview> {
    const { store, request } = admit(actor.access, input);
    const db = await this.tenancy.db(tenant);
    const run = await this.run(tenant, actor);
    try {
      return await db.transaction(
        async (tx) => {
          await takeImportLock(tx);
          const { rows, counts } = await this.plan(tx, run, store, request, PREVIEW);
          return { rows, counts };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      throw importFailure(error);
    }
  }

  /**
   * Imports the valid rows (spec G1 step 7; ADR 0057 api 4.5) after a step-up (S-7), in one
   * transaction: under the import lock, within the daily limit, with the kind's tables locked, the
   * file is planned again against the records as they are now and refused unless every row's
   * action equals the dry run's (S-10). Each change is written through the kind's row functions,
   * read back through its module's loader, audited, and kept in the batch for Undo.
   */
  async commit(tenant: TenantContext, actor: Actor, input: ImportCommitInput): Promise<ImportResult> {
    const { store, request } = admit(actor.access, input);
    await this.stepUp.require(actor.session);
    const db = await this.tenancy.db(tenant);
    const run = await this.run(tenant, actor);
    try {
      return await db.transaction(async (tx) => {
        await takeImportLock(tx);
        await limitLockWait(tx);
        if ((await batchesInLastDay(tx)) >= DAILY_IMPORTS) {
          throw new HttpException(
            {
              code: "rate_limited",
              message: "Your company has imported 50 files in the last 24 hours. Try again later.",
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        await store.lock(tx);
        const number = await nextBatchNumber(tx);
        const id = uuidv7();
        const plan = await this.plan(tx, run, store, request, { id, number });
        if (planActions(plan.rows) !== input.expected) throw conflict("plan_changed", IMPORT_WORDS.planChanged);
        if (plan.counts.create + plan.counts.update === 0) throw refuse(IMPORT_WORDS.nothing);
        for (const change of plan.changes) await store.write(tx, change, run.actorId);
        const changes = await this.readBack(tx, store, plan.changes);
        for (const change of changes) {
          await this.auditLog.record(tenant, actor.audit, recordEntry(store, change, number), tx);
        }
        const batch = {
          id,
          number,
          kind: request.kind,
          fileName: request.fileName,
          mapping: request.mapping,
          counts: plan.counts,
          changes,
        };
        const createdAt = await insertBatch(tx, batch, run.actorId);
        await this.auditLog.record(tenant, actor.audit, batchEntry(batch), tx);
        const names = new Map([[run.actorId, actor.session.user.name]]);
        const summary = summaryOf(
          { ...batch, createdAt, createdBy: run.actorId, undoneAt: null, undoneBy: null },
          names,
        );
        return { batch: summary, rows: plan.rows };
      });
    } catch (error) {
      throw importFailure(error);
    }
  }

  /**
   * Undoes one import (spec G1 step 8; ADR 0057 api 4.6, S-14) after a step-up, all or nothing:
   * refused when the batch is gone or undone, when the person may not import its kind or see its
   * sensitive columns, when any record differs from what the import wrote, when the kind's own
   * rules stop it, or when a live record points at one it created. Created records are
   * soft-deleted with their parts and updated ones get their earlier columns back, newest first.
   */
  async undo(tenant: TenantContext, actor: Actor, batchId: string): Promise<ImportBatchSummary> {
    await this.stepUp.require(actor.session);
    const db = await this.tenancy.db(tenant);
    const userId = actor.access.userId;
    try {
      return await db.transaction(async (tx) => {
        await takeImportLock(tx);
        await limitLockWait(tx);
        const batch = await lockBatch(tx, batchId);
        if (!batch) throw new NotFoundException({ code: "not_found", message: IMPORT_WORDS.gone });
        if (batch.undoneAt) throw conflict("already_undone", IMPORT_WORDS.alreadyUndone(batch.number));
        const store = openKind(actor.access, batch.kind);
        openColumns(actor.access, batch.kind, batch.mapping);
        await store.lock(tx);
        // Waits for a writer still saving a link to a row this Undo removes, so the check below sees it (S-14).
        const removed = batch.changes.flatMap((change) => createdRows(store, change));
        await lockTargets(tx, removed);
        await this.assertUnchanged(tx, store, batch.changes);
        const problem = await store.undoProblem(tx, batch.changes);
        if (problem) throw conflict("import_in_use", problem);
        const used = await this.firstUsed(tx, store, batch.changes);
        if (used) throw conflict("import_in_use", IMPORT_WORDS.inUse(used));
        for (const change of [...batch.changes].reverse()) {
          await store.undo(tx, change);
          await this.auditLog.record(tenant, actor.audit, undoRecordEntry(store, change, batch.number), tx);
        }
        const undoneAt = await markUndone(tx, batch.id, userId);
        await this.auditLog.record(tenant, actor.audit, undoBatchEntry(batch), tx);
        const names = new Map(await loadNames(this.control.db, [batch.createdBy]));
        names.set(userId, actor.session.user.name);
        return summaryOf({ ...batch, undoneAt, undoneBy: userId }, names);
      });
    } catch (error) {
      throw importFailure(error);
    }
  }

  /**
   * Saves a kind's column choices for the next file (spec G1 step 4; ADR 0057 api 4.10). The kind
   * must be open to the person; header names need no sensitive key. Audited (S-13).
   */
  async saveMapping(
    tenant: TenantContext,
    actor: Actor,
    kind: ImportKind,
    columns: Readonly<ColumnMapping>,
  ): Promise<ImportMapping> {
    openKind(actor.access, kind);
    const mapping = mappingOf(importKind(kind), columns);
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      const before = await storedMapping(tx, kind);
      const saved = await upsertMapping(tx, kind, mapping, actor.access.userId);
      await this.auditLog.record(tenant, actor.audit, mappingEntry(saved, before), tx);
      return saved;
    });
  }

  /** The company's clock and the importer, read once per request. */
  private async run(tenant: TenantContext, actor: Actor): Promise<PlanRun> {
    return { tenant, actorId: actor.access.userId, clock: await companyClock(this.control.db, tenant) };
  }

  /** Plans a request against the kind's records as they are in this transaction (never the screen's copy). */
  private async plan(
    tx: CompanyDb,
    run: PlanRun,
    store: KindStore,
    request: ImportRequest,
    batch: { id: string; number: string },
  ): Promise<ImportPlan> {
    const world = emptyImportWorld(await store.world(tx, this.control.db));
    return planImport(IMPORT_HANDLERS[request.kind], request, {
      world,
      companyId: run.tenant.companyId as CompanyId,
      today: run.clock.day,
      now: minuteIn(run.clock.now, run.clock.zone),
      actorId: run.actorId,
      batch,
      newId: () => uuidv7(),
      // Read only by the timesheets kind, which part 1 doesn't run on the API.
      workweekStartDay: 0,
    });
  }

  /**
   * The changes with each `after` as the module's loader reads the record now (ADR 0057 api 4.5
   * step 10): decimals as stored, ids and addresses as loaded, so Undo compares like with like.
   */
  private async readBack(tx: CompanyDb, store: KindStore, changes: readonly ImportChange[]): Promise<ImportChange[]> {
    const now = await store.current(tx, changes);
    return changes.map((change) => {
      const after = now.get(changeKey(change));
      if (after === undefined) throw new Error(`An imported ${change.collection} record could not be read back.`);
      return { ...change, after };
    });
  }

  /**
   * Refuses an Undo when any record differs from what the import wrote (ADR 0057 api 4.6 step 6):
   * edited through its module, by a later import, deleted since, or read differently by a newer
   * loader. Records compare by content, key order aside.
   */
  private async assertUnchanged(tx: CompanyDb, store: KindStore, changes: readonly ImportChange[]): Promise<void> {
    const now = await store.current(tx, changes);
    const changed = changes.find((change) => !sameRecord(now.get(changeKey(change)), change.after));
    if (changed) throw conflict("import_changed", IMPORT_WORDS.changed(recordName(changed)));
  }

  /**
   * The name of the first record the batch created that a live record elsewhere points at, or null
   * (ADR 0057 api 4.8): created records and their created parts are the targets, and rows the batch
   * itself wrote never count.
   */
  private async firstUsed(tx: CompanyDb, store: KindStore, changes: readonly ImportChange[]): Promise<string | null> {
    const partsOf = (change: ImportChange) => createdRows(store, change);
    const targets = changes.flatMap(partsOf);
    const batchIds = new Set([...changes.map((change) => change.id), ...targets.map((target) => target.id)]);
    const found = await firstReference(tx, targets, batchIds);
    if (!found) return null;
    const owner = changes.find((change) => partsOf(change).some((target) => target.id === found));
    return owner ? recordName(owner) : "A record";
  }
}
