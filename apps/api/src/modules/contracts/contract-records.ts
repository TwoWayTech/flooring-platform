import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  changeOrderLines,
  changeOrders,
  contractBillingLines,
  contractBillingReleases,
  contractBillings,
  contractLines,
  contracts,
  insuranceCertificates,
  insuranceCoverages,
  lienWaivers,
} from "@workspace/db/company";
import type {
  ChangeOrder,
  Contract,
  ContractBilling,
  ContractLine,
  InsuranceCertificate,
  LienWaiver,
} from "@workspace/shared";
import { and, asc, desc, inArray, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { fileRows, filesByOwner, loadNames, minuteOf } from "../sales/invoice-records";
import { dayIn, seesDocument } from "../sales/sales-common";

/**
 * Whether the person's data scope covers a contract (contracts.md "Who uses it", `byRep`): own by
 * its sales rep, branch by its branch, or all. Lines, change orders, billings, waivers and
 * certificates follow their contract (blueprint-delta 2026-11-14).
 */
export function seesContract(access: RequestAccess, contract: Pick<Contract, "salesRepId" | "branchId">): boolean {
  return seesDocument(access, contract);
}

/** Contracts with their files, newest number first; `terminatedAt` is read as the company's day. */
export async function loadContracts(
  db: CompanyDb,
  control: ControlDb,
  zone: string,
  ids?: readonly string[],
): Promise<Contract[]> {
  const rows = await db
    .select()
    .from(contracts)
    .where(and(isNull(contracts.deletedAt), ids ? inArray(contracts.id, [...ids]) : undefined))
    .orderBy(desc(contracts.number));
  const fileList =
    rows.length === 0
      ? []
      : await fileRows(
          db,
          "contract",
          rows.map((row) => row.id),
        );
  const files = filesByOwner(
    fileList,
    await loadNames(
      control,
      fileList.map((row) => row.createdBy),
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
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
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    renewal: { mode: row.renewalMode, noticeDays: row.renewalNoticeDays },
    renewedFromId: row.renewedFromId,
    originalValue: row.originalValue,
    retainagePct: row.retainagePct,
    storedRetainagePct: row.storedRetainagePct,
    bondInLieu: row.bondInLieu,
    taxTreatment: row.taxTreatment,
    status: row.status,
    sentAt: row.sentAt ? minuteOf(row.sentAt) : null,
    signedAt: row.signedAt ? minuteOf(row.signedAt) : null,
    signature: row.signature ?? null,
    substantialCompletionAt: row.substantialCompletionAt,
    finalAcceptanceAt: row.finalAcceptanceAt,
    terminatedAt: row.terminatedAt ? dayIn(row.terminatedAt, zone) : null,
    terminationReason: row.terminationReason,
    closeOverrideReason: row.closeOverrideReason,
    files: files.get(row.id) ?? [],
    notes: row.notes,
  }));
}

/** The schedule-of-values lines of some contracts (all when `contractIds` is left out), by code. */
export async function loadContractLines(db: CompanyDb, contractIds?: readonly string[]): Promise<ContractLine[]> {
  if (contractIds?.length === 0) return [];
  const rows = await db
    .select()
    .from(contractLines)
    .where(
      and(
        isNull(contractLines.deletedAt),
        contractIds ? inArray(contractLines.contractId, [...contractIds]) : undefined,
      ),
    )
    .orderBy(asc(contractLines.contractId), asc(contractLines.createdAt), asc(contractLines.id));
  return rows.map((row) => ({
    id: row.id,
    contractId: row.contractId,
    code: row.code,
    description: row.description,
    category: row.category,
    billing: row.billing,
    scheduledValue: row.scheduledValue,
    retainagePct: row.retainagePct,
    storedRetainagePct: row.storedRetainagePct,
    milestoneDueAt: row.milestoneDueAt,
    changeOrderId: row.changeOrderId,
    estimatedCost: row.estimatedCost,
  }));
}

/** Change orders with their lines; `decidedBy` is the decider's name. */
export async function loadChangeOrders(
  db: CompanyDb,
  control: ControlDb,
  filter: { contractIds?: readonly string[]; ids?: readonly string[] } = {},
): Promise<ChangeOrder[]> {
  if (filter.contractIds?.length === 0 || filter.ids?.length === 0) return [];
  const rows = await db
    .select()
    .from(changeOrders)
    .where(
      and(
        isNull(changeOrders.deletedAt),
        filter.contractIds ? inArray(changeOrders.contractId, [...filter.contractIds]) : undefined,
        filter.ids ? inArray(changeOrders.id, [...filter.ids]) : undefined,
      ),
    )
    .orderBy(asc(changeOrders.contractId), asc(changeOrders.createdAt), asc(changeOrders.id));
  const lines =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(changeOrderLines)
          .where(
            and(
              isNull(changeOrderLines.deletedAt),
              inArray(
                changeOrderLines.changeOrderId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(changeOrderLines.createdAt), asc(changeOrderLines.id));
  const names = await loadNames(
    control,
    rows.map((row) => row.decidedById),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    contractId: row.contractId,
    status: row.status,
    reason: row.reason,
    lines: lines
      .filter((line) => line.changeOrderId === row.id)
      .map((line) => ({
        lineId: line.contractLineId,
        description: line.description,
        category: line.category,
        amountDelta: line.amountDelta,
      })),
    submittedAt: row.submittedAt ? minuteOf(row.submittedAt) : null,
    decidedAt: row.decidedAt ? minuteOf(row.decidedAt) : null,
    decidedBy: row.decidedById ? (names.get(row.decidedById) ?? "") : null,
    decisionReason: row.decisionReason,
    files: [],
  }));
}

/** Billings with their cumulative lines and release shares, in number order; `postedBy` is a name. */
export async function loadBillings(
  db: CompanyDb,
  control: ControlDb,
  contractIds?: readonly string[],
): Promise<ContractBilling[]> {
  if (contractIds?.length === 0) return [];
  const rows = await db
    .select()
    .from(contractBillings)
    .where(
      and(
        isNull(contractBillings.deletedAt),
        contractIds ? inArray(contractBillings.contractId, [...contractIds]) : undefined,
      ),
    )
    .orderBy(asc(contractBillings.contractId), asc(contractBillings.number));
  const billingIds = rows.map((row) => row.id);
  const [lines, releases, names] = await Promise.all([
    billingIds.length === 0
      ? []
      : db
          .select()
          .from(contractBillingLines)
          .where(and(isNull(contractBillingLines.deletedAt), inArray(contractBillingLines.billingId, billingIds)))
          .orderBy(asc(contractBillingLines.createdAt), asc(contractBillingLines.id)),
    billingIds.length === 0
      ? []
      : db
          .select()
          .from(contractBillingReleases)
          .where(and(isNull(contractBillingReleases.deletedAt), inArray(contractBillingReleases.billingId, billingIds)))
          .orderBy(asc(contractBillingReleases.createdAt), asc(contractBillingReleases.id)),
    loadNames(
      control,
      rows.map((row) => row.postedById),
    ),
  ]);
  return rows.map((row) => ({
    id: row.id,
    contractId: row.contractId,
    number: row.number,
    kind: row.kind,
    periodEnd: row.periodEnd,
    status: row.status,
    lines: lines
      .filter((line) => line.billingId === row.id)
      .map((line) => ({
        lineId: line.contractLineId,
        completedToDate: line.completedToDate,
        storedBalance: line.storedBalance,
        retainagePct: line.retainagePct,
        storedRetainagePct: line.storedRetainagePct,
      })),
    releases: releases
      .filter((release) => release.billingId === row.id)
      .map((release) => ({ lineId: release.contractLineId, amount: release.amount })),
    gross: row.gross,
    withheld: row.withheld,
    released: row.released,
    invoiceId: row.invoiceId,
    billId: row.billId,
    postedAt: minuteOf(row.postedAt),
    postedBy: names.get(row.postedById) ?? "",
  }));
}

/** Lien waivers of some contracts (all when left out), oldest first. */
export async function loadWaivers(
  db: CompanyDb,
  filter: { contractIds?: readonly string[]; ids?: readonly string[] } = {},
): Promise<LienWaiver[]> {
  if (filter.contractIds?.length === 0 || filter.ids?.length === 0) return [];
  const rows = await db
    .select()
    .from(lienWaivers)
    .where(
      and(
        isNull(lienWaivers.deletedAt),
        filter.contractIds ? inArray(lienWaivers.contractId, [...filter.contractIds]) : undefined,
        filter.ids ? inArray(lienWaivers.id, [...filter.ids]) : undefined,
      ),
    )
    .orderBy(asc(lienWaivers.createdAt), asc(lienWaivers.id));
  return rows.map((row) => ({
    id: row.id,
    contractId: row.contractId,
    direction: row.direction,
    type: row.type,
    paymentId: row.paymentId,
    supplierPaymentId: row.supplierPaymentId,
    amount: row.amount,
    throughDate: row.throughDate,
    state: row.state,
    statutoryForm: row.statutoryForm,
    signedOn: row.signedOn,
    files: [],
    status: row.status,
  }));
}

/**
 * Certificates of insurance on contracts, with their coverages. A certificate with no contract
 * belongs to no contract's scope, so it is never listed here.
 */
export async function loadCertificates(
  db: CompanyDb,
  contractIds?: readonly string[],
): Promise<InsuranceCertificate[]> {
  if (contractIds?.length === 0) return [];
  const rows = await db
    .select()
    .from(insuranceCertificates)
    .where(
      and(
        isNull(insuranceCertificates.deletedAt),
        contractIds ? inArray(insuranceCertificates.contractId, [...contractIds]) : undefined,
      ),
    )
    .orderBy(asc(insuranceCertificates.createdAt), asc(insuranceCertificates.id));
  const coverages =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(insuranceCoverages)
          .where(
            and(
              isNull(insuranceCoverages.deletedAt),
              inArray(
                insuranceCoverages.certificateId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(insuranceCoverages.createdAt), asc(insuranceCoverages.id));
  return rows.flatMap((row) =>
    row.contractId
      ? [
          {
            id: row.id,
            supplierId: row.supplierId,
            contractId: row.contractId,
            producer: row.producer,
            holder: row.holder,
            additionalInsured: row.additionalInsured,
            files: [],
            coverages: coverages
              .filter((coverage) => coverage.certificateId === row.id)
              .map((coverage) => ({
                type: coverage.type,
                insurer: coverage.insurer,
                policyNumber: coverage.policyNumber,
                effectiveOn: coverage.effectiveOn,
                expiresOn: coverage.expiresOn,
                limits: coverage.limits,
              })),
          },
        ]
      : [],
  );
}
