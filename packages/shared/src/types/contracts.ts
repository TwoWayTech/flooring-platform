import type { TaxCategory } from "../us-pack/tax";
import type { Address } from "./company";
import type { FileMeta } from "./sales";

/** Who the other company is: a customer we bill, or a subcontractor who bills us (spec D1). */
export type ContractDirection = "customer" | "subcontractor";

/** A master agreement carries terms only; a project contract carries value and a schedule (spec D1). */
export type ContractKind = "master" | "project";

/** Stored statuses (ADR 0026). Expired is derived, like an expired quote. */
export type ContractStatus = "draft" | "sent" | "active" | "completed" | "closed" | "terminated";

/** How sales tax falls on retained money (ADR 0026): an example to confirm with an accountant. */
export type ContractTaxTreatment = "on_billing" | "on_release" | "contractor_pays";

/** A simulated signature's audit record; the screen labels it simulated (ADR 0026). */
export interface SignatureRecord {
  documentId: string;
  version: number;
  hash: string;
  signerName: string;
  signerEmail: string;
  signerRole: string;
  consentVersion: string;
  recordedBy: string;
  signedAt: string;
  events: { kind: "created" | "sent" | "viewed" | "signed" | "declined" | "voided"; at: string }[];
}

/** A contract with another company (spec D1, ADR 0026). */
export interface Contract {
  id: string;
  /** CTR-1001. */
  number: string;
  direction: ContractDirection;
  kind: ContractKind;
  masterId: string | null;
  customerId: string | null;
  supplierId: string | null;
  /** A subcontract's customer contract, for pass-through retainage reminders. */
  parentContractId: string | null;
  title: string;
  scope: string;
  branchId: string;
  locationId: string;
  jobSite: Address;
  /** Who earns commission on its invoices. */
  salesRepId: string;
  startsAt: string;
  endsAt: string;
  renewal: { mode: "none" | "manual" | "auto"; noticeDays: number };
  renewedFromId: string | null;
  /** Pre-tax value at signing; change orders add to it. Zero on a master. */
  originalValue: string;
  retainagePct: string;
  storedRetainagePct: string;
  /** A retainage bond replaces the holdback where the state allows it (ADR 0026). */
  bondInLieu: boolean;
  taxTreatment: ContractTaxTreatment;
  status: ContractStatus;
  sentAt: string | null;
  signedAt: string | null;
  signature: SignatureRecord | null;
  substantialCompletionAt: string | null;
  finalAcceptanceAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  closeOverrideReason: string | null;
  files: FileMeta[];
  notes: string;
}

/** One schedule-of-values or milestone line (ADR 0026). */
export interface ContractLine {
  id: string;
  contractId: string;
  code: string;
  description: string;
  category: TaxCategory;
  billing: "percent" | "milestone";
  /** Current value: the original plus approved change orders. */
  scheduledValue: string;
  /** Overrides the contract's rates; null follows the contract. */
  retainagePct: string | null;
  storedRetainagePct: string | null;
  milestoneDueAt: string | null;
  changeOrderId: string | null;
  /** Sensitive: sets invoice cost in proportion, so margin plans are not paid on 100 % (plan K-10). */
  estimatedCost: string;
}

/** A change to scope and value (spec D2). Approved is final. */
export interface ChangeOrder {
  id: string;
  number: string;
  contractId: string;
  status: "draft" | "pending" | "approved" | "rejected" | "void";
  reason: string;
  lines: { lineId: string | null; description: string; category: TaxCategory; amountDelta: string }[];
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  files: FileMeta[];
}

/** Cumulative figures for one line in one pay application. Rates are snapshotted. */
export interface BillingLine {
  lineId: string;
  completedToDate: string;
  storedBalance: string;
  retainagePct: string;
  storedRetainagePct: string;
}

/** One pay application or retainage release (ADR 0026). */
export interface ContractBilling {
  id: string;
  contractId: string;
  number: number;
  kind: "progress" | "release";
  periodEnd: string;
  status: "posted" | "void";
  lines: BillingLine[];
  releases: { lineId: string; amount: string }[];
  gross: string;
  withheld: string;
  released: string;
  invoiceId: string | null;
  billId: string | null;
  postedAt: string;
  postedBy: string;
}

/** The four lien waiver forms (ADR 0026). */
export type LienWaiverType =
  "conditional_progress" | "unconditional_progress" | "conditional_final" | "unconditional_final";

/** A lien waiver recorded against a payment (spec D2). No legal text is generated in the demo. */
export interface LienWaiver {
  id: string;
  contractId: string;
  direction: "given" | "received";
  type: LienWaiverType;
  paymentId: string | null;
  supplierPaymentId: string | null;
  amount: string;
  throughDate: string;
  state: string;
  statutoryForm: boolean;
  signedOn: string | null;
  files: FileMeta[];
  status: "requested" | "received" | "superseded";
}

/** One coverage on a certificate; each has its own expiry (ADR 0026). */
export interface InsuranceCoverage {
  type: "general" | "auto" | "umbrella" | "workers_comp";
  insurer: string;
  policyNumber: string;
  effectiveOn: string;
  expiresOn: string;
  limits: string;
}

/** A subcontractor's certificate of insurance (spec D1). */
export interface InsuranceCertificate {
  id: string;
  supplierId: string;
  contractId: string;
  producer: string;
  holder: string;
  coverages: InsuranceCoverage[];
  additionalInsured: boolean;
  files: FileMeta[];
}
