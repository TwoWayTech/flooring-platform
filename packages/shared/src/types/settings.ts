import type { NumberSettings } from "../numbers";
import type { OvertimeRule } from "../us-pack/overtime";
import type { TaxRule } from "../us-pack/tax";
import type { Address, Branding } from "./company";
import type { PaymentTerms } from "./sales";

/** Categories of audit entries. */
export type AuditCategory = "role" | "user" | "ceiling" | "settings" | "data" | "security";

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
    areaUnit: "sq_ft" | "sq_yd";
  };
  currency: {
    base: "USD";
    locked: boolean;
    extra: { code: string; rate: string; asOf: string }[];
  };
  tax: {
    pricesInclude: "exclusive" | "inclusive";
    rounding: "line" | "invoice";
    rules: TaxRule[];
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
  };
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
}
