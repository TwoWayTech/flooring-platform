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
  /** Names of the records the ids in before and after stand for, where the log found them (#58). */
  names?: Record<string, string>;
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

/** Approval on expenses, the same two fields as payments (ADR 0023). */
export interface ExpenseSettings {
  approvalRequired: boolean;
  approvalThreshold: string;
}

/** How company-wide costs are split across locations (spec F1, assumption F-1). */
export interface SharedCostSettings {
  rule: "revenue" | "floor_area" | "equal" | "fixed";
  /** Percent per location id, when the rule is fixed. */
  fixedPct: Record<string, string>;
}

/** Settings → Meetings (spec E, ADR 0021). */
export interface MeetingSettings {
  defaultReminderMin: number;
  /** What happens to a guest added by email (assumption E-1). */
  newGuestHandling: "contact" | "lead" | "none";
  allowProposals: boolean;
  hideGuestList: boolean;
}

/** Settings → HR (spec C1, ADR 0024): pay calendar, holidays and what employees may see. */
export interface HrSettings {
  /** The day the fixed workweek starts, 0 Sunday to 6 Saturday; the law needs it designated. */
  workweekStartDay: number;
  payFrequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  /** The first day weekly and biweekly periods count from. */
  payPeriodAnchor: string;
  holidays: { date: string; name: string }[];
  showPayToEmployees: boolean;
  /** Company default; each employee can override it (spec C1, assumption C-2: off). */
  showCommissionToEmployees: boolean;
  showRatesToEmployees: boolean;
  showTeamCalendarToEmployees: boolean;
  /** Clock in and out in the portal (spec C2, optional per company). */
  clockEnabled: boolean;
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
  /** Settings → Expenses (spec F1). */
  expenses: ExpenseSettings;
  sharedCosts: SharedCostSettings;
  /** Settings → HR (spec C1). */
  hr: HrSettings;
  /** Settings → Meetings (spec E). */
  meetings: MeetingSettings;
  /** Sender details on every email (spec A4). */
  email: EmailSettings;
}
