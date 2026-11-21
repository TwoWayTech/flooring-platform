import { createHash } from "node:crypto";
import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { attachments, auditLog, branches, contractLines, contracts, locations, suppliers } from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  addDays,
  billLedger,
  closeProblem,
  contractFigures,
  contractSchedule,
  daysBetween,
  draftProblem,
  MAX_PROOF_FILES,
  moneyString,
  nextNumber,
  sum,
  type Address,
  type ChangeOrder,
  type Contract,
  type ContractBilling,
  type ContractDirection,
  type ContractKind,
  type ContractLine,
  type ContractSchedule,
  type ContractTaxTreatment,
  type InsuranceCertificate,
  type LienWaiver,
  type SignatureRecord,
} from "@workspace/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService } from "../../core/notifications/notification.service";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadBills, loadSupplierPayments } from "../purchasing/payables-records";
import { invoiceState } from "../sales/invoice-ledger";
import { checkProofs, withStoredProofs, type ProofUpload } from "../sales/proof-files";
import { companyClock, notFound, refuse, seesCustomer, type CompanyClock } from "../sales/sales-common";
import { loadBranches, loadCustomers } from "../sales/sales-records";
import {
  auditContract,
  lockContract,
  NUMBER_LOCK,
  partyOf,
  visibleContractIds,
  type ContractRow,
} from "./contract-common";
import {
  loadBillings,
  loadCertificates,
  loadChangeOrders,
  loadContractLines,
  loadContracts,
  loadWaivers,
  seesContract,
} from "./contract-records";

/** One schedule line as the form sends it; `estimatedCost` is left out by people who can't see it. */
export interface ContractLineFields {
  code: string;
  description: string;
  category: ContractLine["category"];
  billing: ContractLine["billing"];
  scheduledValue: string;
  retainagePct: string | null;
  storedRetainagePct: string | null;
  milestoneDueAt: string | null;
  estimatedCost?: string | undefined;
}

/** A contract as the form sends it (contracts.md "Steps in the screens", item 1). */
export interface ContractFields {
  direction: ContractDirection;
  kind: ContractKind;
  customerId: string | null;
  supplierId: string | null;
  title: string;
  scope: string;
  /** Used only when the creator has no branch of their own. */
  branchId?: string | null | undefined;
  locationId: string;
  jobSite: Address;
  startsAt: string;
  endsAt: string;
  renewal: Contract["renewal"];
  retainagePct: string;
  storedRetainagePct: string;
  bondInLieu: boolean;
  taxTreatment: ContractTaxTreatment;
  notes: string;
  lines: ContractLineFields[];
}

const SENSITIVE_COST = "contracts.contract.view_sensitive";

/**
 * The contract register on the API (contracts.md; ADR 0044): drafts with their schedule of values,
 * sending, a simulated signature, completion, closing, termination, renewal and files. Every write
 * locks the contract, checks its data scope (404 outside it) and writes audit_log in the same
 * transaction. Billings and their postings are in ContractBillingService (ADR 0045).
 */
@Injectable()
export class ContractsService {
  private readonly logger = new Logger("Contracts");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Every contract the person's data scope covers (spec "Who uses it", `byRep`). */
  async list(tenant: TenantContext, access: RequestAccess): Promise<Contract[]> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    return (await loadContracts(db, this.control.db, clock.zone)).filter((row) => seesContract(access, row));
  }

  /** The schedule lines of the contracts in scope. `estimatedCost` is stripped on the way out without view_sensitive. */
  async listLines(tenant: TenantContext, access: RequestAccess): Promise<ContractLine[]> {
    const db = await this.tenancy.db(tenant);
    return loadContractLines(db, await visibleContractIds(db, access));
  }

  /** The change orders of the contracts in scope. */
  async listChangeOrders(tenant: TenantContext, access: RequestAccess): Promise<ChangeOrder[]> {
    const db = await this.tenancy.db(tenant);
    return loadChangeOrders(db, this.control.db, { contractIds: await visibleContractIds(db, access) });
  }

  /** The billings of the contracts in scope; ContractBillingService posts and voids them (ADR 0045). */
  async listBillings(tenant: TenantContext, access: RequestAccess): Promise<ContractBilling[]> {
    const db = await this.tenancy.db(tenant);
    return loadBillings(db, this.control.db, await visibleContractIds(db, access));
  }

  /** The lien waivers of the contracts in scope. */
  async listWaivers(tenant: TenantContext, access: RequestAccess): Promise<LienWaiver[]> {
    const db = await this.tenancy.db(tenant);
    return loadWaivers(db, { contractIds: await visibleContractIds(db, access) });
  }

  /** The certificates of insurance of the contracts in scope. */
  async listCertificates(tenant: TenantContext, access: RequestAccess): Promise<InsuranceCertificate[]> {
    const db = await this.tenancy.db(tenant);
    return loadCertificates(db, await visibleContractIds(db, access));
  }

  /**
   * The schedule of values and release allocation of the contracts in scope (contracts.md rules
   * 10a and 11a): each line's billed, retained and remaining money, and which billings each
   * release paid out, derived from the posted billings with decimal.js and never stored (ADR 0013).
   */
  async schedule(tenant: TenantContext, access: RequestAccess): Promise<ContractSchedule> {
    const db = await this.tenancy.db(tenant);
    const ids = await visibleContractIds(db, access);
    const [lines, billings] = await Promise.all([loadContractLines(db, ids), loadBillings(db, this.control.db, ids)]);
    return contractSchedule(lines, billings);
  }

  /**
   * Adds a draft or edits one (spec rule 2; "Contract status"): only a draft changes, and its lines
   * are replaced. A master keeps no value, retainage or lines. A new contract's rep is its creator
   * and its branch the creator's; an edit keeps both, so it cannot move out of anyone's scope.
   * Someone without view_sensitive keeps each line's stored estimated cost (spec edge case 13).
   */
  async save(tenant: TenantContext, actor: Actor, id: string | null, input: ContractFields): Promise<Contract> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await this.checkParty(db, actor.access, input);
    await this.checkLocation(db, input.locationId);
    const branchId = id ? null : await this.newBranch(db, actor.access, input.branchId ?? null);
    const savedId = id ?? uuidv7();
    await db.transaction(async (tx) => {
      const before = id ? await lockContract(tx, actor.access, id) : null;
      if (before && before.status !== "draft") throw refuse("Only a draft can be edited. Use a change order instead.");
      const kept = before ? await loadContractLines(tx, [before.id]) : [];
      // A master keeps no lines, but the same checks run, so turning a draft into a master can't drop costs.
      const lines = linesToStore(input.kind === "master" ? [] : input.lines, kept, actor.access);
      const values = {
        direction: input.direction,
        kind: input.kind,
        customerId: input.direction === "customer" ? input.customerId : null,
        supplierId: input.direction === "subcontractor" ? input.supplierId : null,
        title: input.title.trim(),
        scope: input.scope.trim(),
        locationId: input.locationId,
        jobSite: input.jobSite,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        renewalMode: input.renewal.mode,
        renewalNoticeDays: input.renewal.noticeDays,
        originalValue: moneyString(sum(lines.map((line) => line.scheduledValue))),
        retainagePct: input.kind === "master" ? "0" : input.retainagePct,
        storedRetainagePct: input.kind === "master" ? "0" : input.storedRetainagePct,
        bondInLieu: input.bondInLieu,
        taxTreatment: input.taxTreatment,
        notes: input.notes.trim(),
      };
      let row: ContractRow;
      if (before) {
        [row] = (await tx
          .update(contracts)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(contracts.id, before.id))
          .returning()) as [ContractRow];
        await tx
          .update(contractLines)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(contractLines.contractId, before.id), isNull(contractLines.deletedAt)));
      } else {
        await tx.execute(NUMBER_LOCK);
        const used = await tx.select({ number: contracts.number }).from(contracts);
        const number = nextNumber(
          "CTR-",
          used.map((r) => r.number),
          1001,
        );
        [row] = (await tx
          .insert(contracts)
          .values({
            id: savedId,
            number,
            ...values,
            branchId: branchId!,
            salesRepId: actor.access.userId,
            status: "draft",
            createdBy: actor.access.userId,
          })
          .returning()) as [ContractRow];
      }
      if (lines.length > 0) {
        await tx
          .insert(contractLines)
          .values(lines.map((line) => ({ id: uuidv7(), contractId: row.id, ...line, createdBy: actor.access.userId })));
      }
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        before ? "Edited contract" : "Added contract",
        row,
        // Each line's code, description and value before and after, so a schedule change (a swap
        // included) can be traced; costs stay out (rule 5; PR #23 reviews).
        before ? { ...editable(before), lines: kept.map(traced) } : null,
        { ...editable(row), lines: lines.map(traced) },
      );
    });
    return (await loadContracts(db, this.control.db, clock.zone, [savedId]))[0]!;
  }

  /** Sends a draft for signature (spec "Contract status"): `draftProblem` must pass; the other party is emailed. */
  async send(tenant: TenantContext, actor: Actor, id: string): Promise<Contract> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const row = await db.transaction(async (tx) => {
      const before = await lockContract(tx, actor.access, id);
      if (before.status !== "draft") throw refuse("Only a draft can be sent for signature.");
      const [contract] = await loadContracts(tx, this.control.db, clock.zone, [id]);
      const problem = draftProblem(contract!, await loadContractLines(tx, [id]));
      if (problem) throw refuse(problem);
      await this.setStatus(tx, id, { status: "sent", sentAt: clock.now });
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Sent contract for signature",
        before,
        { status: "draft" },
        {
          status: "sent",
        },
      );
      return before;
    });
    await this.askToSign(tenant, actor, db, row, clock.now);
    return this.one(db, clock, id);
  }

  /** Takes a contract that waits for signature back to draft. */
  async recall(tenant: TenantContext, actor: Actor, id: string): Promise<Contract> {
    return this.move(tenant, actor, id, "sent", "Only a contract waiting for signature can be recalled.", () => ({
      update: { status: "draft", sentAt: null },
      action: "Recalled contract",
      after: { status: "draft" },
    }));
  }

  /**
   * Records a simulated signature (spec step 3; ADR 0044): the typed signer, who entered it and
   * when, with no signing provider. The hash is SHA-256 of the signed terms and schedule, so later
   * changes are detectable. No PDF is filed on the API.
   */
  async sign(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    input: { signerName: string; signerRole: string },
  ): Promise<Contract> {
    const signerName = input.signerName.trim();
    if (signerName.length < 3) throw refuse("Type the signer's full name.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const before = await lockContract(tx, actor.access, id);
      if (before.status !== "sent") throw refuse("Send the contract for signature first.");
      const lines = await loadContractLines(tx, [id]);
      const party = await partyOf(tx, before);
      const signedAt = clock.now.toISOString().slice(0, 16);
      const signature: SignatureRecord = {
        documentId: before.id,
        // One version per time it was sent for signature, so a recall and resend is a new version.
        version: await sendCount(tx, before.id),
        hash: termsHash(before, lines),
        signerName,
        signerEmail: party.email,
        signerRole: input.signerRole.trim(),
        consentVersion: "demo-1",
        recordedBy: actor.session.user.name,
        signedAt,
        events: [
          { kind: "sent", at: before.sentAt ? before.sentAt.toISOString().slice(0, 16) : signedAt },
          { kind: "signed", at: signedAt },
        ],
      };
      await this.setStatus(tx, id, { status: "active", signedAt: clock.now, signature });
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Recorded simulated signature",
        before,
        { status: "sent" },
        {
          status: "active",
          signerName,
        },
      );
    });
    return this.one(db, clock, id);
  }

  /** Marks substantial completion of an active project (spec "Contract status"); a master is renewed or ended instead. */
  async complete(tenant: TenantContext, actor: Actor, id: string): Promise<Contract> {
    return this.move(tenant, actor, id, "active", "Only an active contract can be completed.", (row, clock) => {
      if (row.kind === "master") throw refuse("A master agreement is renewed or terminated, not completed.");
      return {
        update: { status: "completed", substantialCompletionAt: clock.day },
        action: "Completed contract",
        after: { status: "completed" },
      };
    });
  }

  /**
   * Closes a completed contract (spec rule 18): nothing held, nothing owed on its invoices or
   * bills, and a final waiver on file. Closing despite a problem needs contracts.contract.approve
   * and a reason of at least 3 characters.
   */
  async close(tenant: TenantContext, actor: Actor, id: string, overrideReason: string | null): Promise<Contract> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const before = await lockContract(tx, actor.access, id);
      if (before.status !== "completed") throw refuse("Only a completed contract can be closed.");
      const problem = await this.closeCheck(tx, clock, before);
      const reason = overrideReason?.trim() ?? "";
      if (problem) {
        if (!reason) throw refuse(problem);
        if (!actor.access.permissions.has("contracts.contract.approve")) {
          throw new ForbiddenException({
            code: "forbidden",
            message: "Only someone who approves contracts can override.",
          });
        }
        if (reason.length < 3) throw refuse("Say why the contract closes despite the check.");
      }
      const override = problem ? reason : null;
      await this.setStatus(tx, id, { status: "closed", finalAcceptanceAt: clock.day, closeOverrideReason: override });
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Closed contract",
        before,
        { status: "completed" },
        {
          status: "closed",
          ...(override ? { overrideReason: override, problem } : {}),
        },
      );
    });
    return this.one(db, clock, id);
  }

  /** Ends an active or completed contract with a reason (spec "Contract status"); held retainage stays until released. */
  async terminate(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<Contract> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Give the reason for ending this contract.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const before = await lockContract(tx, actor.access, id);
      if (before.status !== "active" && before.status !== "completed")
        throw refuse("This contract can't be terminated.");
      await this.setStatus(tx, id, { status: "terminated", terminatedAt: clock.now, terminationReason: why });
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Terminated contract",
        before,
        { status: before.status },
        {
          status: "terminated",
          reason: why,
        },
      );
    });
    return this.one(db, clock, id);
  }

  /**
   * Starts the next term as a new draft linked to this one (ADR 0026; blueprint-delta 2026-11-14,
   * fixing spec edge case 1): a new number, the same rep, branch, terms and current lines, dates
   * moved on by the old term's length, and no signature, files or milestone dates.
   */
  async renew(tenant: TenantContext, actor: Actor, id: string): Promise<Contract> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const savedId = uuidv7();
    await db.transaction(async (tx) => {
      const source = await lockContract(tx, actor.access, id);
      if (source.status === "draft" || source.status === "sent") throw refuse("Only a signed contract can be renewed.");
      const lines = source.kind === "master" ? [] : await loadContractLines(tx, [id]);
      await tx.execute(NUMBER_LOCK);
      const used = await tx.select({ number: contracts.number }).from(contracts);
      const number = nextNumber(
        "CTR-",
        used.map((r) => r.number),
        1001,
      );
      const span = Math.max(daysBetween(source.startsAt, source.endsAt), 1);
      const [row] = (await tx
        .insert(contracts)
        .values({
          ...renewedTerms(source),
          id: savedId,
          number,
          startsAt: source.endsAt,
          endsAt: addDays(source.endsAt, span),
          renewedFromId: source.id,
          originalValue: moneyString(sum(lines.map((line) => line.scheduledValue))),
          status: "draft",
          createdBy: actor.access.userId,
        })
        .returning()) as [ContractRow];
      if (lines.length > 0) {
        await tx.insert(contractLines).values(
          lines.map((line) => ({
            id: uuidv7(),
            contractId: savedId,
            code: line.code,
            description: line.description,
            category: line.category,
            billing: line.billing,
            scheduledValue: line.scheduledValue,
            retainagePct: line.retainagePct,
            storedRetainagePct: line.storedRetainagePct,
            milestoneDueAt: null,
            changeOrderId: null,
            estimatedCost: line.estimatedCost,
            createdBy: actor.access.userId,
          })),
        );
      }
      await auditContract(this.auditLog, tenant, actor, tx, "Added contract", row, null, {
        ...editable(row),
        renewedFrom: source.number,
      });
    });
    return this.one(db, clock, savedId);
  }

  /** Adds documents to a contract (spec "Contract" `files`): proof-style files, at most three in all. */
  async addFiles(tenant: TenantContext, actor: Actor, id: string, files: readonly ProofUpload[]): Promise<Contract> {
    if (files.length === 0) throw refuse("Choose at least one file.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const [found] = await loadContracts(db, this.control.db, clock.zone, [id]);
    if (!found || !seesContract(actor.access, found)) throw notFound("contract");
    const proofs = checkProofs(files, found.files.length);
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        const before = await lockContract(tx, actor.access, id);
        await attach(tx, "contract", id, actor.access.userId);
        // Counted again under the lock, so two uploads at once can't pass the limit together.
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(attachments)
          .where(
            and(eq(attachments.ownerType, "contract"), eq(attachments.ownerId, id), isNull(attachments.deletedAt)),
          );
        if ((count?.count ?? 0) > MAX_PROOF_FILES) throw refuse(`A contract keeps at most ${MAX_PROOF_FILES} files.`);
        await auditContract(this.auditLog, tenant, actor, tx, "Added contract files", before, null, {
          files: proofs.map((file) => file.name),
        });
      }),
    );
    return this.one(db, clock, id);
  }

  /** A status move with one guard on the current status, audited in the same transaction. */
  private async move(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    from: ContractRow["status"],
    wrongStatus: string,
    next: (
      row: ContractRow,
      clock: CompanyClock,
    ) => { update: Partial<typeof contracts.$inferInsert>; action: string; after: Record<string, unknown> },
  ): Promise<Contract> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const before = await lockContract(tx, actor.access, id);
      if (before.status !== from) throw refuse(wrongStatus);
      const { update, action, after } = next(before, clock);
      await this.setStatus(tx, id, update);
      await auditContract(this.auditLog, tenant, actor, tx, action, before, { status: from }, after);
    });
    return this.one(db, clock, id);
  }

  private async setStatus(tx: CompanyDb, id: string, update: Partial<typeof contracts.$inferInsert>): Promise<void> {
    await tx
      .update(contracts)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(contracts.id, id));
  }

  private async one(db: CompanyDb, clock: CompanyClock, id: string): Promise<Contract> {
    return (await loadContracts(db, this.control.db, clock.zone, [id]))[0]!;
  }

  /**
   * Why a contract can't close (spec rule 18), or null. Held comes from posted billings; the
   * balance is each posted billing's invoice ledger and, unlike the demo (edge case 2), its bill's
   * too; the final waiver is a received waiver whose type ends in "final".
   */
  private async closeCheck(tx: CompanyDb, clock: CompanyClock, row: ContractRow): Promise<string | null> {
    const [[contract], lines, billings, orders, waivers] = await Promise.all([
      loadContracts(tx, this.control.db, clock.zone, [row.id]),
      loadContractLines(tx, [row.id]),
      loadBillings(tx, this.control.db, [row.id]),
      loadChangeOrders(tx, this.control.db, { contractIds: [row.id] }),
      loadWaivers(tx, { contractIds: [row.id] }),
    ]);
    const figures = contractFigures(contract!, lines, billings, orders);
    const posted = billings.filter((billing) => billing.status === "posted");
    const balances: string[] = [];
    for (const billing of posted.filter((b) => b.invoiceId)) {
      balances.push((await invoiceState(tx, this.control.db, billing.invoiceId!, clock)).ledger.balance);
    }
    const billIds = posted.flatMap((billing) => (billing.billId ? [billing.billId] : []));
    if (billIds.length > 0) {
      const [bills, payments] = await Promise.all([
        loadBills(tx, this.control.db, billIds),
        loadSupplierPayments(tx, this.control.db),
      ]);
      for (const bill of bills) balances.push(billLedger(bill, payments, clock.day).balance);
    }
    return closeProblem({
      held: figures.held,
      balance: moneyString(sum(balances)),
      hasFinalWaiver: waivers.some((w) => w.type.endsWith("final") && w.status === "received"),
    });
  }

  /**
   * The other company exists and suits the direction: a customer in the person's scope, or an
   * active supplier (spec "Steps in the screens", item 1).
   */
  private async checkParty(db: CompanyDb, access: RequestAccess, input: ContractFields): Promise<void> {
    if (!input.title.trim()) throw refuse("Give the contract a title.");
    if (input.direction === "customer") {
      if (!input.customerId) throw refuse("Choose the other company.");
      const [[customer], owners] = await Promise.all([loadCustomers(db, [input.customerId]), loadBranches(db)]);
      if (!customer || !seesCustomer(access, customer, owners)) throw refuse("Choose the other company.");
      return;
    }
    if (!input.supplierId) throw refuse("Choose the other company.");
    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), isNull(suppliers.deletedAt), eq(suppliers.status, "active")));
    if (!supplier) throw refuse("Choose an active subcontractor.");
  }

  private async checkLocation(db: CompanyDb, locationId: string): Promise<void> {
    const [row] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, locationId), isNull(locations.deletedAt)));
    if (!row) throw refuse("Choose the warehouse.");
  }

  /**
   * A new contract's branch (spec "Contract" `branchId`): the creator's own. Only someone with no
   * branch picks one, and only with company-wide scope, so nobody files a contract outside it.
   */
  private async newBranch(db: CompanyDb, access: RequestAccess, given: string | null): Promise<string> {
    if (access.branchId) return access.branchId;
    if (!given || access.dataScope !== "all") {
      throw refuse("You have no branch, so the contract can't be filed. Ask an Owner to set your branch.");
    }
    const [row] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, given), isNull(branches.deletedAt)));
    if (!row) throw refuse("Choose the branch.");
    return row.id;
  }

  /** Emails the other party that the contract waits for signature (`contract.signature`). */
  private async askToSign(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    row: ContractRow,
    sentAt: Date,
  ): Promise<void> {
    try {
      const party = await partyOf(db, row);
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "contract.signature",
        source: { type: "contract", id: row.id },
        // Sending again after a recall is a new message (spec "Notification events").
        version: sentAt.toISOString(),
        to: [{ kind: party.kind, id: party.id, name: party.name, email: party.email }],
        values: { "party.name": party.name, "contract.number": row.number, "contract.title": row.title },
      });
    } catch {
      this.logger.warn("A contract was sent for signature, but its email could not be queued.");
    }
  }
}

/**
 * The lines to store on save. The estimated cost is taken from the request only from someone with
 * view_sensitive who sent one; otherwise a line keeps the stored cost of the line with the same
 * code, else zero (CLAUDE.md rule 5; spec edge case 13).
 */
function linesToStore(lines: readonly ContractLineFields[], kept: readonly ContractLine[], access: RequestAccess) {
  const seesCost = access.permissions.has(SENSITIVE_COST);
  // Codes name the lines, and the cost follows the code, so each code may appear once (PR #23 review).
  const codes = lines.map((line) => line.code.trim());
  if (new Set(codes).size !== codes.length) throw refuse("Give each line its own code.");
  const keptCost = new Map(kept.map((line) => [line.code.trim(), line.estimatedCost]));
  // Without view_sensitive, no stored line may lose its code (costed or not, so the refusal reveals
  // nothing), and stored codes must be unique, so a cost is never dropped or moved (PR #23 reviews).
  if (!seesCost) {
    const stored = kept.map((line) => line.code.trim());
    const lost = stored.some((code) => !codes.includes(code));
    if (lost || new Set(stored).size !== stored.length) {
      throw refuse("Keep each line's code; someone who sees costs can change the schedule.");
    }
  }
  return lines.map((line) => ({
    code: line.code.trim(),
    description: line.description.trim(),
    category: line.category,
    billing: line.billing,
    scheduledValue: moneyString(line.scheduledValue),
    retainagePct: line.retainagePct,
    storedRetainagePct: line.storedRetainagePct,
    milestoneDueAt: line.milestoneDueAt,
    estimatedCost: moneyString(
      seesCost && line.estimatedCost !== undefined ? line.estimatedCost : (keptCost.get(line.code.trim()) ?? "0"),
    ),
  }));
}

/** What the save audit keeps of a line: its code, description and value, never its cost. */
function traced(line: { code: string; description: string; scheduledValue: string }) {
  return { code: line.code, description: line.description, scheduledValue: line.scheduledValue };
}

/** A SHA-256 of the signed terms and schedule, as the signature record's hash (ADR 0044). */
function termsHash(row: ContractRow, lines: readonly ContractLine[]): string {
  const terms = {
    number: row.number,
    title: row.title,
    scope: row.scope,
    customerId: row.customerId,
    supplierId: row.supplierId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    originalValue: row.originalValue,
    retainagePct: row.retainagePct,
    storedRetainagePct: row.storedRetainagePct,
    taxTreatment: row.taxTreatment,
    notes: row.notes,
    direction: row.direction,
    kind: row.kind,
    locationId: row.locationId,
    jobSite: row.jobSite,
    bondInLieu: row.bondInLieu,
    renewalMode: row.renewalMode,
    renewalNoticeDays: row.renewalNoticeDays,
    // Every term a line carries except its estimated cost, which is internal (PR #23 review).
    lines: lines.map((line) => [
      line.code,
      line.description,
      line.category,
      line.billing,
      line.scheduledValue,
      line.retainagePct ?? null,
      line.storedRetainagePct ?? null,
      line.milestoneDueAt ?? null,
    ]),
  };
  return createHash("sha256").update(JSON.stringify(terms)).digest("hex");
}

/** How many times a contract was sent for signature, from its audit entries. */
async function sendCount(tx: CompanyDb, contractId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.targetId, contractId), eq(auditLog.action, "Sent contract for signature")));
  return Math.max(row?.count ?? 0, 1);
}

/** The terms a renewal carries over from the contract it renews (ADR 0044). */
function renewedTerms(row: ContractRow) {
  return {
    direction: row.direction,
    kind: row.kind,
    masterId: row.masterId,
    customerId: row.customerId,
    supplierId: row.supplierId,
    parentContractId: row.parentContractId,
    title: row.title,
    scope: row.scope,
    branchId: row.branchId,
    locationId: row.locationId,
    jobSite: row.jobSite,
    salesRepId: row.salesRepId,
    renewalMode: row.renewalMode,
    renewalNoticeDays: row.renewalNoticeDays,
    retainagePct: row.retainagePct,
    storedRetainagePct: row.storedRetainagePct,
    bondInLieu: row.bondInLieu,
    taxTreatment: row.taxTreatment,
    notes: row.notes,
  };
}

/** The fields a person edits on a contract, for its audit entries (CLAUDE.md rule 10). */
function editable(row: ContractRow) {
  const {
    title,
    direction,
    kind,
    customerId,
    supplierId,
    startsAt,
    endsAt,
    originalValue,
    retainagePct,
    taxTreatment,
  } = row;
  return {
    title,
    direction,
    kind,
    customerId,
    supplierId,
    startsAt,
    endsAt,
    originalValue,
    retainagePct,
    taxTreatment,
  };
}
