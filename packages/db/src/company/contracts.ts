import type {
  Address,
  ContractDirection,
  ContractKind,
  ContractStatus,
  ContractTaxTreatment,
  InsuranceCoverage,
  LienWaiverType,
  SignatureRecord,
  TaxCategory,
} from "@workspace/shared";
import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { at, business, day, money, rate, userRef } from "../columns";
import { customers } from "./customers";
import { branches, locations } from "./organization";
import { invoices, paymentsReceived } from "./sales";
import { paymentsMade, supplierBills, suppliers } from "./purchasing";

/**
 * A contract with a customer we bill or a subcontractor who bills us, master or project (ADR
 * 0026). Expired is derived. The signature is simulated in the demo and kept as an audit record.
 */
export const contracts = pgTable(
  "contracts",
  {
    ...business(),
    number: text().notNull(),
    direction: text().$type<ContractDirection>().notNull(),
    kind: text().$type<ContractKind>().notNull(),
    masterId: uuid().references((): AnyPgColumn => contracts.id),
    customerId: uuid().references(() => customers.id),
    supplierId: uuid().references(() => suppliers.id),
    parentContractId: uuid().references((): AnyPgColumn => contracts.id),
    title: text().notNull(),
    scope: text().notNull().default(""),
    branchId: uuid()
      .notNull()
      .references(() => branches.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    jobSite: jsonb().$type<Address>().notNull(),
    salesRepId: userRef().notNull(),
    startsAt: day().notNull(),
    endsAt: day().notNull(),
    renewalMode: text().$type<"none" | "manual" | "auto">().notNull().default("none"),
    renewalNoticeDays: integer().notNull().default(0),
    renewedFromId: uuid().references((): AnyPgColumn => contracts.id),
    originalValue: money().notNull().default("0"),
    retainagePct: rate().notNull().default("0"),
    storedRetainagePct: rate().notNull().default("0"),
    bondInLieu: boolean().notNull().default(false),
    taxTreatment: text().$type<ContractTaxTreatment>().notNull(),
    status: text().$type<ContractStatus>().notNull(),
    sentAt: at(),
    signedAt: at(),
    signature: jsonb().$type<SignatureRecord>(),
    substantialCompletionAt: day(),
    finalAcceptanceAt: day(),
    terminatedAt: at(),
    terminationReason: text(),
    closeOverrideReason: text(),
    notes: text().notNull().default(""),
  },
  (table) => [uniqueIndex("contracts_number_uidx").on(table.number)],
);

/** A schedule-of-values or milestone line; null rates follow the contract. */
export const contractLines = pgTable("contract_lines", {
  ...business(),
  contractId: uuid()
    .notNull()
    .references(() => contracts.id),
  code: text().notNull(),
  description: text().notNull(),
  category: text().$type<TaxCategory>().notNull(),
  billing: text().$type<"percent" | "milestone">().notNull(),
  scheduledValue: money().notNull(),
  retainagePct: rate(),
  storedRetainagePct: rate(),
  milestoneDueAt: day(),
  changeOrderId: uuid().references((): AnyPgColumn => changeOrders.id),
  /** Sensitive: sets invoice cost in proportion (plan K-10). */
  estimatedCost: money().notNull().default("0"),
});

/** A change to scope and value; approved is final (spec D2). */
export const changeOrders = pgTable("change_orders", {
  ...business(),
  number: text().notNull(),
  contractId: uuid()
    .notNull()
    .references(() => contracts.id),
  status: text().$type<"draft" | "pending" | "approved" | "rejected" | "void">().notNull(),
  reason: text().notNull(),
  submittedAt: at(),
  decidedAt: at(),
  decidedById: userRef(),
  decisionReason: text(),
});

/** One line of a change order; a null contract line adds a new one. */
export const changeOrderLines = pgTable("change_order_lines", {
  ...business(),
  changeOrderId: uuid()
    .notNull()
    .references(() => changeOrders.id),
  contractLineId: uuid().references(() => contractLines.id),
  description: text().notNull(),
  category: text().$type<TaxCategory>().notNull(),
  amountDelta: money().notNull(),
});

/** A pay application or retainage release; it posts directly, with no draft (ADR 0026). */
export const contractBillings = pgTable("contract_billings", {
  ...business(),
  contractId: uuid()
    .notNull()
    .references(() => contracts.id),
  number: integer().notNull(),
  kind: text().$type<"progress" | "release">().notNull(),
  periodEnd: day().notNull(),
  status: text().$type<"posted" | "void">().notNull(),
  gross: money().notNull(),
  withheld: money().notNull(),
  released: money().notNull(),
  invoiceId: uuid().references((): AnyPgColumn => invoices.id),
  billId: uuid().references((): AnyPgColumn => supplierBills.id),
  postedAt: at().notNull(),
  postedById: userRef().notNull(),
});

/** Cumulative figures for one contract line in one billing, with rates snapshotted. */
export const contractBillingLines = pgTable("contract_billing_lines", {
  ...business(),
  billingId: uuid()
    .notNull()
    .references(() => contractBillings.id),
  contractLineId: uuid()
    .notNull()
    .references(() => contractLines.id),
  completedToDate: money().notNull(),
  storedBalance: money().notNull(),
  retainagePct: rate().notNull(),
  storedRetainagePct: rate().notNull(),
});

/** Retainage released on one contract line by a release billing. */
export const contractBillingReleases = pgTable("contract_billing_releases", {
  ...business(),
  billingId: uuid()
    .notNull()
    .references(() => contractBillings.id),
  contractLineId: uuid()
    .notNull()
    .references(() => contractLines.id),
  amount: money().notNull(),
});

/** A lien waiver given or received against a payment (spec D2). */
export const lienWaivers = pgTable("lien_waivers", {
  ...business(),
  contractId: uuid()
    .notNull()
    .references(() => contracts.id),
  direction: text().$type<"given" | "received">().notNull(),
  type: text().$type<LienWaiverType>().notNull(),
  paymentId: uuid().references(() => paymentsReceived.id),
  supplierPaymentId: uuid().references(() => paymentsMade.id),
  amount: money().notNull(),
  throughDate: day().notNull(),
  state: text().notNull(),
  statutoryForm: boolean().notNull().default(false),
  signedOn: day(),
  status: text().$type<"requested" | "received" | "superseded">().notNull(),
});

/** A subcontractor's certificate of insurance; each coverage has its own expiry. */
export const insuranceCertificates = pgTable("insurance_certificates", {
  ...business(),
  supplierId: uuid()
    .notNull()
    .references(() => suppliers.id),
  contractId: uuid().references(() => contracts.id),
  producer: text().notNull(),
  holder: text().notNull(),
  additionalInsured: boolean().notNull().default(false),
});

/** One coverage on a certificate. */
export const insuranceCoverages = pgTable("insurance_coverages", {
  ...business(),
  certificateId: uuid()
    .notNull()
    .references(() => insuranceCertificates.id),
  type: text().$type<InsuranceCoverage["type"]>().notNull(),
  insurer: text().notNull(),
  policyNumber: text().notNull(),
  effectiveOn: day().notNull(),
  expiresOn: day().notNull(),
  limits: text().notNull(),
});
