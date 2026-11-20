import { MONEY_TEXT } from "../decimal-text";
import { NUMBER_KINDS, type NumberKind, type NumberSettings } from "../numbers";
import type { CompanyProfile, CompanySettings, ExpenseSettings, PaymentSettings } from "../types/settings";
import { overtimeRuleProblem } from "../us-pack/overtime";
import { isStateCode, ZIP_PATTERN } from "../us-pack/states";

/** An EIN as the IRS writes it: 12-3456789 (spec rule 28). */
export const EIN_PATTERN = /^\d{2}-\d{7}$/;

/**
 * A plain email address: something, an @, a domain with a dot, and no spaces. The import and the
 * demo Outbox keep copies of the same rule until a sweep moves them here (ADR 0059).
 */
export const EMAIL_TEXT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A website printed on documents: http or https only, so no `javascript:` or other scheme gets in. */
export const WEBSITE_TEXT = /^https?:\/\/[^\s"'<>]+$/i;

/** A document number prefix: a letter or digit, then up to nine letters, digits or hyphens ("PAY-"). */
export const DOCUMENT_PREFIX_TEXT = /^[A-Za-z0-9][A-Za-z0-9-]{0,9}$/;

/** What Company profile says about each field it refuses, the same words in both modes. */
export const PROFILE_MESSAGES = {
  legalName: "Enter the legal name on your tax filings.",
  ein: "Enter the EIN as 12-3456789.",
  phone: "Enter a phone number customers can call.",
  email: "Enter a valid email address.",
  website: "Enter the website as https://example.com, or leave it empty.",
  street: "Enter the street address.",
  city: "Enter the city.",
  state: "Use a two-letter state code, for example CO.",
  zip: "Enter a ZIP such as 80202 or 80202-1234.",
  position: "Find the address again: its map position is not a pair of numbers.",
} as const;

/** What Payments says about each field it refuses, each naming its field. */
export const PAYMENT_MESSAGES = {
  approvalRequired: "Choose whether payments wait for a second person.",
  approvalThreshold: "Enter the payment approval amount as a number such as 1000.00, or leave it empty.",
  writeOffMax: "Enter the largest write-off as a number such as 5.00, or leave it empty.",
  paymentPrefix: "Use 1 to 10 letters, digits or hyphens for the payment prefix, such as PAY-.",
  refundPrefix: "Use 1 to 10 letters, digits or hyphens for the refund prefix, such as RF-.",
  samePrefix: "Use different prefixes for payments and refunds.",
} as const;

/** What Expense approval says about the fields it refuses. */
export const EXPENSE_MESSAGES = {
  approvalRequired: "Choose whether expenses wait for approval.",
  approvalThreshold: "Enter the expense approval amount as a number such as 1000.00, or leave it empty.",
} as const;

/** What Number format says about what it refuses that no single kind's range covers. */
export const NUMBER_MESSAGES = {
  kindsOnce: "Give each kind of number once.",
  negativeStyle: "Choose how negative numbers show: a minus sign or brackets.",
  compactDashboards: "Choose whether dashboards shorten large numbers.",
} as const;

/** Whether a field is blank once trimmed. */
const blank = (text: string) => text.trim() === "";

/** Whether an optional map coordinate is absent or a finite number. */
const coordinate = (value: unknown) => value === undefined || (typeof value === "number" && Number.isFinite(value));

/** Whether an amount is empty or plain money text (`MONEY_TEXT`), stored as typed (ADR 0059 D13). */
const amountOk = (value: string) => value === "" || MONEY_TEXT.test(value);

/**
 * Why a company profile can't be saved, or null (spec rule 28). Fields are checked trimmed and
 * stored as sent. The page builds its inline checks from the same patterns and messages.
 */
export function companyProfileProblem(profile: CompanyProfile): string | null {
  const { address } = profile;
  if (blank(profile.legalName)) return PROFILE_MESSAGES.legalName;
  if (!EIN_PATTERN.test(profile.ein)) return PROFILE_MESSAGES.ein;
  if (profile.phone.trim().length < 7) return PROFILE_MESSAGES.phone;
  if (!EMAIL_TEXT.test(profile.email.trim())) return PROFILE_MESSAGES.email;
  const website = profile.website.trim();
  if (website !== "" && !WEBSITE_TEXT.test(website)) return PROFILE_MESSAGES.website;
  if (blank(address.street)) return PROFILE_MESSAGES.street;
  if (blank(address.city)) return PROFILE_MESSAGES.city;
  if (!isStateCode(address.state)) return PROFILE_MESSAGES.state;
  if (!ZIP_PATTERN.test(address.zip)) return PROFILE_MESSAGES.zip;
  if (!coordinate(address.lat) || !coordinate(address.lng)) return PROFILE_MESSAGES.position;
  return null;
}

/**
 * Why a number format can't be saved, or null (spec rule 26): every kind once, a whole number of
 * decimals in its range, a known negative style, and the company's own locale and currency, which
 * no page edits. `current` is the company's stored format, or the US pack's defaults when none is
 * stored, so the locale and currency come from company settings and the pack, never a literal
 * (CLAUDE.md rule 12; ADR 0059 D12).
 */
export function numberSettingsProblem(next: NumberSettings, current: NumberSettings): string | null {
  const kinds = Object.keys(NUMBER_KINDS) as NumberKind[];
  if (Object.keys(next.decimals).some((kind) => !kinds.includes(kind as NumberKind))) return NUMBER_MESSAGES.kindsOnce;
  for (const kind of kinds) {
    const { min, max, label } = NUMBER_KINDS[kind];
    const places = next.decimals[kind];
    if (!Number.isInteger(places) || places < min || places > max)
      return `Choose between ${min} and ${max} decimals for ${label}.`;
  }
  if (next.negativeStyle !== "minus" && next.negativeStyle !== "parens") return NUMBER_MESSAGES.negativeStyle;
  if (typeof next.compactDashboards !== "boolean") return NUMBER_MESSAGES.compactDashboards;
  if (next.locale !== current.locale || next.currency !== current.currency)
    return `The number format keeps the company's locale and currency (${current.locale}, ${current.currency}).`;
  return null;
}

/**
 * Why payment rules can't be saved, or null (sales.md rules 28 and 31): each amount empty or plain
 * money, each prefix a document prefix, and the payment and refund prefixes different, compared
 * without case, because refunds have no unique number index (ADR 0059 D18). The threshold is
 * checked even while approval is off (D21).
 */
export function paymentSettingsProblem(payments: PaymentSettings): string | null {
  if (!amountOk(payments.approvalThreshold)) return PAYMENT_MESSAGES.approvalThreshold;
  if (!amountOk(payments.writeOffMax)) return PAYMENT_MESSAGES.writeOffMax;
  if (!DOCUMENT_PREFIX_TEXT.test(payments.paymentPrefix)) return PAYMENT_MESSAGES.paymentPrefix;
  if (!DOCUMENT_PREFIX_TEXT.test(payments.refundPrefix)) return PAYMENT_MESSAGES.refundPrefix;
  if (payments.paymentPrefix.toUpperCase() === payments.refundPrefix.toUpperCase()) return PAYMENT_MESSAGES.samePrefix;
  if (typeof payments.approvalRequired !== "boolean") return PAYMENT_MESSAGES.approvalRequired;
  return null;
}

/** Why expense approval can't be saved, or null (finance-expenses.md rule 4): the amount empty or plain money. */
export function expenseSettingsProblem(expenses: ExpenseSettings): string | null {
  if (!amountOk(expenses.approvalThreshold)) return EXPENSE_MESSAGES.approvalThreshold;
  if (typeof expenses.approvalRequired !== "boolean") return EXPENSE_MESSAGES.approvalRequired;
  return null;
}

/**
 * Why a settings section can't be saved, or null: the content rules both modes run, with the same
 * words (ADR 0059). `current` is the stored section (or the API's never-saved answer), so a rule can
 * refuse a change that no page makes. Localization keeps its overtime check (ADR 0050); every other
 * section gets its rules when its part moves to the API.
 */
export function settingsSectionProblem<K extends keyof CompanySettings>(
  section: K,
  value: CompanySettings[K],
  current: CompanySettings[K],
): string | null {
  // One key is set, so reading a section's property narrows the value to that section's type.
  const settings = { [section]: value } as Partial<CompanySettings>;
  if (settings.profile) return companyProfileProblem(settings.profile);
  if (settings.numbers) return numberSettingsProblem(settings.numbers, current as NumberSettings);
  if (settings.payments) return paymentSettingsProblem(settings.payments);
  if (settings.expenses) return expenseSettingsProblem(settings.expenses);
  if (settings.localization) return overtimeRuleProblem(settings.localization.payroll.overtimeRule);
  return null;
}
