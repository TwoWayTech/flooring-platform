import type { NumberSettings } from "../numbers";
import type { ProductCategory } from "./catalog";

/** Product categories that carry waste: every one but services. */
export type WasteCategory = Exclude<ProductCategory, "service">;
import type { OvertimeRule } from "../us-pack/overtime";
import type { TaxRule } from "../us-pack/tax";
import type { CompanyDefaultRate, JurisdictionRate } from "../us-pack/tax-defaults";
import type { Address, Branding } from "./company";
import type { EmailSettings } from "./notifications";
import type { PaymentTerms } from "./sales";

/** Categories of audit entries. */
export type AuditCategory = "role" | "user" | "ceiling" | "settings" | "data" | "security" | "payment";

/** One audit log entry with before and after values (blueprint "Users, roles", rule 8). */
export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  category: AuditCategory;
  action: string;
  target: string;
  before: string | null;
  after: string | null;
}

/** Settings: Localization and tax (blueprint "Localization, currency and tax settings"). */
export interface LocalizationSettings {
  region: {
    country: "US";
    primaryState: string;
    statesOfOperation: string[];
    timeZone: string;
    locale: string;
    dateFormat: "MM/dd/yyyy" | "yyyy-MM-dd" | "MMM d, yyyy";
    firstDayOfWeek: "sunday" | "monday";
    fiscalYearStartMonth: number;
  };
  currency: {
    base: "USD";
    locked: boolean;
    extra: { code: string; rate: string; asOf: string }[];
  };
  tax: {
    pricesInclude: "exclusive" | "inclusive";
    rounding: "line" | "invoice";
    /** State default rules: what is taxable in a state and at which rate. */
    rules: TaxRule[];
    /** County rates that replace a state default (spec A5). */
    jurisdictions: JurisdictionRate[];
    /** The company's own rate for states of operation without a state rule, or none. */
    companyDefault: CompanyDefaultRate | null;
    filing: { state: string; frequency: "monthly" | "quarterly" | "annual" }[];
    certificateTypes: string[];
  };
  payroll: {
    overtimeRule: OvertimeRule;
    payFrequency: "weekly" | "biweekly" | "semimonthly";
    ptoAccrualHoursPerMonth: string;
    holidayState: string;
  };
  documents: {
    defaultTerms: PaymentTerms;
    lateFeePct: string;
    quotePrefix: string;
    invoicePrefix: string;
    poPrefix: string;
    legalFooter: string;
    defaultDepositPct: string;
    /** Days a sent quote stays valid by default (spec B1). */
    quoteExpiryDays: number;
    /** Days after issue that the balance of a deposit invoice falls due (plan K-3). */
    balanceDueDays: number;
    /** Waste % a new material line starts with, per product category (spec B3). */
    defaultWastePct: Record<WasteCategory, string>;
  };
}

/** How customer payments are numbered, checked and closed (spec Appendix A, Settings → Payments). */
export interface PaymentSettings {
  /** Payments wait for a second person before they count (two-person check). */
  approvalRequired: boolean;
  /** With approval on, only payments above this amount wait; empty means every payment. */
  approvalThreshold: string;
  /** The largest leftover balance that may be written off; empty means no limit. */
  writeOffMax: string;
  paymentPrefix: string;
  refundPrefix: string;
}

/** Stock rules (spec C1): adjustments above this quantity wait for an Owner or Manager. */
export interface InventorySettings {
  /** In the product's stock unit (ft, sq ft or items); empty means no approval. */
  adjustmentApprovalQty: string;
}

/**
 * A commission rule (spec E2): for a role or one person, a percent of paid revenue or of gross
 * margin, earned when payments are confirmed, with optional tiers (from an amount, a higher rate).
 */
export interface CommissionRule {
  id: string;
  appliesTo: { kind: "role"; roleKey: string } | { kind: "user"; userId: string };
  basis: "paid_revenue" | "gross_margin";
  ratePct: string;
  tiers: { fromAmount: string; ratePct: string }[];
}

/** Company profile in Settings: Company profile. */
export interface CompanyProfile {
  legalName: string;
  dba: string;
  ein: string;
  phone: string;
  email: string;
  website: string;
  address: Address;
}

/** Everything one company stores in its settings. */
export interface CompanySettings {
  branding: Branding;
  localization: LocalizationSettings;
  numbers: NumberSettings;
  profile: CompanyProfile;
  payments: PaymentSettings;
  inventory: InventorySettings;
  /** Settings → Commissions (spec E2). */
  commissions: { rules: CommissionRule[] };
  /** Sender details on every email (spec A4). */
  email: EmailSettings;
}
