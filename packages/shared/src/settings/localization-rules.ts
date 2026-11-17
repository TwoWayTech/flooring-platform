import { CATEGORY_LABELS } from "../catalog-labels";
import { PERCENT_TEXT } from "../decimal-text";
import { dec } from "../money";
import { PAYMENT_TERM_LABELS } from "../operations/quotes";
import type { ProductCategory } from "../types";
import type { LocalizationSettings, WasteCategory } from "../types/settings";
import { OVERTIME_RULE_MESSAGE, overtimeRuleProblem } from "../us-pack/overtime";
import { isStateCode } from "../us-pack/states";

/**
 * A document number prefix: a letter or digit, then up to nine letters, digits or hyphens ("PAY-").
 * Document numbers (here) and payment numbers (`section-rules.ts`) share it.
 */
export const DOCUMENT_PREFIX_TEXT = /^[A-Za-z0-9][A-Za-z0-9-]{0,9}$/;

/** The longest prefix `DOCUMENT_PREFIX_TEXT` takes, where a prefix input stops typing. */
export const DOCUMENT_PREFIX_MAX = 10;

/**
 * The credit-note series (sales.md rule 22): credit notes are invoices, in the invoices' one number
 * index, numbered under this fixed prefix. No quote, invoice or purchase order prefix may start with
 * it, so an invoice can never take a credit note's number (ADR 0059, part 2a, review round 1).
 */
export const CREDIT_NOTE_PREFIX = "CR-";

/** The first credit-note number, `CR-5001` (sales.md rule 22). */
export const FIRST_CREDIT_NOTE = 5001;

/** The categories a default waste covers: every product category but services, exactly `WasteCategory`. */
export const WASTE_CATEGORIES: readonly WasteCategory[] = (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter(
  (category): category is WasteCategory => category !== "service",
);

/** The longest legal footer documents print; `documentsProblem` refuses a longer one in both modes. */
export const LEGAL_FOOTER_MAX = 1000;

/** What Sales and documents says about each field it refuses, the same words in both modes. */
export const DOCUMENT_MESSAGES = {
  defaultTerms: "Choose the default payment terms.",
  lateFeePct: "Enter the late fee per month as a percent such as 1.5, from 0 to 100.",
  defaultDepositPct: "Enter the default deposit as a percent such as 50, from 0 to 100.",
  wasteCategories: "Give a default waste for each product category.",
  waste: (label: string) => `Enter the waste for ${label} as a percent such as 10, from 0 to 100.`,
  quoteExpiryDays: "Enter how many days quotes stay valid, a whole number from 1 to 365.",
  balanceDueDays: "Enter the days until a deposit invoice's balance is due, a whole number from 0 to 365.",
  quotePrefix: "Use 1 to 10 letters, digits or hyphens for the quote number prefix, such as Q-.",
  invoicePrefix: "Use 1 to 10 letters, digits or hyphens for the invoice number prefix, such as INV-.",
  poPrefix: "Use 1 to 10 letters, digits or hyphens for the purchase order prefix, such as PO-.",
  samePrefix: "Use different prefixes for quotes, invoices and purchase orders.",
  creditNotePrefix: `Credit notes are numbered ${CREDIT_NOTE_PREFIX}; choose a prefix that doesn't start with ${CREDIT_NOTE_PREFIX}.`,
  legalFooter: "Keep the legal footer to 1,000 characters.",
} as const;

/** What Payroll rules says about each field it refuses. */
export const PAYROLL_MESSAGES = {
  overtimeRule: OVERTIME_RULE_MESSAGE,
  holidayState: "Choose the state whose public holidays timesheets skip, such as CO.",
} as const;

/**
 * Sales and documents as a save sends it, before `documentsProblem` has checked it: the terms and
 * the waste categories as plain text. The stored type is assignable to it, so DemoStore passes its
 * value as it is, and the API's body check outputs it without a cast (ADR 0059, part 2a).
 */
export type DocumentsInput = Omit<LocalizationSettings["documents"], "defaultTerms" | "defaultWastePct"> & {
  defaultTerms: string;
  defaultWastePct: Record<string, string>;
};

/** Payroll rules as a save sends them, before `payrollProblem` has checked the rule. */
export type PayrollInput = Omit<LocalizationSettings["payroll"], "overtimeRule"> & { overtimeRule: string };

/** What each tab the API serves takes as its body. */
export interface LocalizationTabInput {
  documents: DocumentsInput;
  payroll: PayrollInput;
}

/**
 * Whether a value is a percent the quote API takes (sales.md rules 8 and 12; STATUS B6): plain
 * decimal text (`PERCENT_TEXT`) no higher than 100, the same check as `POST /quotes`' `PERCENT`, so
 * a saved default deposit or waste never makes a new quote unsavable and nothing else reaches decimal.js.
 */
function isPercent(value: unknown): boolean {
  return typeof value === "string" && PERCENT_TEXT.test(value) && dec(value).lte(100);
}

/** Whether a value is a whole number of days from `min` to `max`. */
function wholeDays(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Why a waste map can't be saved, or null. It must hold exactly the waste categories: a missing
 * one makes the server refuse every Sales line of it (`defaultWastePct` gives `undefined`, which
 * matches only a blank waste), and an extra one is not a category (sales.md rule 8; STATUS B6).
 */
function wasteProblem(waste: Record<string, string>): string | null {
  const given = Object.keys(waste);
  if (given.length !== WASTE_CATEGORIES.length || WASTE_CATEGORIES.some((category) => !Object.hasOwn(waste, category)))
    return DOCUMENT_MESSAGES.wasteCategories;
  const bad = WASTE_CATEGORIES.find((category) => !isPercent(waste[category]));
  return bad ? DOCUMENT_MESSAGES.waste(CATEGORY_LABELS[bad]) : null;
}

/**
 * Why the three document prefixes can't be saved, or null: each a document prefix; none starting
 * with the credit notes' `CR-` without case, because credit notes share the invoices' number index
 * and an invoice numbered in their series would make every later credit note fail (review round 1);
 * and all three different without case, so a quote and an invoice never share a number such as
 * `Q-1001` (ADR 0059 D4).
 */
function prefixProblem(documents: DocumentsInput): string | null {
  if (!DOCUMENT_PREFIX_TEXT.test(documents.quotePrefix)) return DOCUMENT_MESSAGES.quotePrefix;
  if (!DOCUMENT_PREFIX_TEXT.test(documents.invoicePrefix)) return DOCUMENT_MESSAGES.invoicePrefix;
  if (!DOCUMENT_PREFIX_TEXT.test(documents.poPrefix)) return DOCUMENT_MESSAGES.poPrefix;
  const prefixes = [documents.quotePrefix, documents.invoicePrefix, documents.poPrefix].map((p) => p.toUpperCase());
  if (prefixes.some((prefix) => prefix.startsWith(CREDIT_NOTE_PREFIX))) return DOCUMENT_MESSAGES.creditNotePrefix;
  return new Set(prefixes).size === prefixes.length ? null : DOCUMENT_MESSAGES.samePrefix;
}

/**
 * Why Sales and documents can't be saved, or null (sales.md "Settings that drive this module";
 * ADR 0059, part 2a): known payment terms; the late fee, default deposit and every default waste as
 * the quote API takes a percent; whole days (quotes valid 1 to 365, a deposit's balance due 0 to
 * 365, the page's own bounds); three different document prefixes, none in the credit-note series; and a footer of at most
 * `LEGAL_FOOTER_MAX` characters. The first problem is answered, with its field's words.
 */
export function documentsProblem(documents: DocumentsInput): string | null {
  if (!Object.hasOwn(PAYMENT_TERM_LABELS, documents.defaultTerms)) return DOCUMENT_MESSAGES.defaultTerms;
  if (!isPercent(documents.lateFeePct)) return DOCUMENT_MESSAGES.lateFeePct;
  if (!isPercent(documents.defaultDepositPct)) return DOCUMENT_MESSAGES.defaultDepositPct;
  const waste = wasteProblem(documents.defaultWastePct);
  if (waste) return waste;
  if (!wholeDays(documents.quoteExpiryDays, 1, 365)) return DOCUMENT_MESSAGES.quoteExpiryDays;
  if (!wholeDays(documents.balanceDueDays, 0, 365)) return DOCUMENT_MESSAGES.balanceDueDays;
  const prefixes = prefixProblem(documents);
  if (prefixes) return prefixes;
  if (typeof documents.legalFooter !== "string" || documents.legalFooter.length > LEGAL_FOOTER_MAX)
    return DOCUMENT_MESSAGES.legalFooter;
  return null;
}

/**
 * Why Payroll rules can't be saved, or null: the overtime rule as ADR 0050 allows it (California
 * only while its switch is on), and a holiday calendar that is a US state, from the US pack's list
 * the Holiday calendar offers (CLAUDE.md rule 12).
 */
export function payrollProblem(payroll: PayrollInput): string | null {
  const rule = overtimeRuleProblem(payroll.overtimeRule);
  if (rule) return rule;
  return typeof payroll.holidayState === "string" && isStateCode(payroll.holidayState)
    ? null
    : PAYROLL_MESSAGES.holidayState;
}

/**
 * Why one tab of Localization and tax (or the Sales and documents page) can't be saved, or null:
 * DemoStore's `updateLocalization` runs it, as the API's routes run each tab's rule (ADR 0059, part
 * 2a). Region and Currency get their rules in part 2b, which also passes the stored tab as `current`
 * with the first rule that reads it; Sales tax gets its rules in part 3.
 */
export function localizationTabProblem<T extends keyof LocalizationSettings>(
  tab: T,
  value: LocalizationSettings[T],
): string | null {
  // One key is set, so reading a tab's property narrows the value to that tab's type (as settingsSectionProblem does).
  const tabs = { [tab]: value } as Partial<LocalizationSettings>;
  if (tabs.documents) return documentsProblem(tabs.documents);
  if (tabs.payroll) return payrollProblem(tabs.payroll);
  return null;
}

/**
 * Why the whole Localization and tax section can't be saved, or null: every tab's rule, for
 * `updateSettings("localization")` and `resetSettings`, which no screen calls (ADR 0059, part 2a).
 */
export function localizationProblem(localization: LocalizationSettings): string | null {
  return payrollProblem(localization.payroll) ?? documentsProblem(localization.documents);
}
