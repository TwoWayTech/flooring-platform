import { CATEGORY_LABELS } from "../catalog-labels";
import { FX_RATE_TEXT, PERCENT_TEXT, sameOptionalDecimal } from "../decimal-text";
import { dec } from "../money";
import { PAYMENT_TERM_LABELS } from "../operations/quotes";
import type { PermissionKey } from "../permissions/catalog";
import type { ProductCategory } from "../types";
import type { LocalizationSettings, WasteCategory } from "../types/settings";
import { OVERTIME_RULE_MESSAGE, overtimeRuleProblem } from "../us-pack/overtime";
import { isStateCode } from "../us-pack/states";
// Region's tax key comes from the one table of tab keys (CLAUDE.md rule 4; ADR 0059, part 2b), so
// this file is no longer a leaf. sections.ts and tax-settings.ts import nothing from settings/, so
// there is no cycle (part 3a).
import { LOCALIZATION_TABS } from "./sections";
import { taxChanges, taxProblem, type TaxInput } from "./tax-settings";

type Region = LocalizationSettings["region"];
type Currency = LocalizationSettings["currency"];

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

/**
 * Region as a save sends it, before `regionProblem` has checked it: the country, date format and
 * week start as plain text (ADR 0059, part 2b, D5). The stored type is assignable to it.
 */
export type RegionInput = Omit<Region, "country" | "dateFormat" | "firstDayOfWeek"> & {
  country: string;
  dateFormat: string;
  firstDayOfWeek: string;
};

/** Currency as a save sends it, before `currencyProblem` has checked it: the base as plain text. */
export type CurrencyInput = Omit<Currency, "base"> & { base: string };

/** What each tab the API serves takes as its body. */
export interface LocalizationTabInput {
  documents: DocumentsInput;
  payroll: PayrollInput;
  region: RegionInput;
  currency: CurrencyInput;
  tax: TaxInput;
}

/**
 * Whether the person saving holds a key: the API's `access.permissions.has`, DemoStore's viewer
 * (View as limits it), the page's `useCan()` (ADR 0059, part 2b).
 */
export type HoldsKey = (key: PermissionKey) => boolean;

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
 * Whether a Payroll rules save changes the overtime rule, which changes everyone's overtime pay, so
 * it needs a step-up (ADR 0063); the holiday calendar alone does not. `current` is the stored tab, or
 * undefined when none is stored, which counts as a change (the safest reading).
 */
export function overtimeRuleChanged(
  next: Pick<PayrollInput, "overtimeRule">,
  current: { overtimeRule?: unknown } | undefined,
): boolean {
  return current?.overtimeRule !== next.overtimeRule;
}

// Region and Currency (ADR 0059, part 2b).

/** The date formats the Region tab offers; `regionProblem` takes exactly these. */
export const DATE_FORMATS = [
  "MMM d, yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
] as const satisfies readonly Region["dateFormat"][];

/** The days a week can start on, as the Region tab offers them; `regionProblem` takes exactly these. */
export const WEEK_STARTS = ["monday", "sunday"] as const satisfies readonly Region["firstDayOfWeek"][];

/** What Region says about each field it refuses, the same words in both modes. */
export const REGION_MESSAGES = {
  timeZone: "The company's time zone is set when the company is set up. Ask us to change it.",
  countryLocale: (country: string, locale: string) =>
    `The region keeps the company's country and locale (${country}, ${locale}).`,
  primaryState: "Choose the primary state, such as CO.",
  statesOfOperation: "Choose at least one state of operation, each once, from the list.",
  dateFormat: "Choose one of the date formats offered.",
  firstDayOfWeek: "Choose Monday or Sunday for the first day of the week.",
  fiscalYearStartMonth: "Choose the month the fiscal year starts, January to December.",
  statesNeedTax:
    "Changing the states of operation changes where sales tax is collected, so it also needs the sales tax permission.",
} as const;

/**
 * What Currency says about each field it refuses, the same words in both modes. A rate's words are
 * `exchange`, so packages/shared declares no new field named like a rate and the sensitive-field
 * check (`access-rules.test.ts`) needs no blanket `rate` entry, which would also wave through a
 * future pay rate named `rate`.
 */
export const CURRENCY_MESSAGES = {
  base: (base: string) => `The company's base currency stays ${base}.`,
  codes: "Other currencies can't be added, removed or renamed here. Change only their rates.",
  exchange: (code: string) => `Enter the rate for ${code} as a number above 0 with up to 8 decimals, such as 1.3870.`,
} as const;

/** Whether a list of states holds at least one US pack code (CLAUDE.md rule 12), each once. */
function statesOk(states: readonly string[]): boolean {
  return (
    Array.isArray(states) &&
    states.length > 0 &&
    states.every((state) => isStateCode(state)) &&
    new Set(states).size === states.length
  );
}

/**
 * Why a Region save can't be stored, or null (blueprint p20 Region; ADR 0059, part 2b, D3 to D5;
 * CLAUDE.md rule 12). `current` is the stored region, the first problem is answered:
 * 1. The time zone must be the company's own. On the API `current.timeZone` is control's
 *    `tenants.time_zone` (the caller overlays it); in the demo DemoStore's own copy. Every API date is
 *    read in that zone, so a change would move past invoice days: it is set when the company is set up.
 * 2. Country and locale stay the stored ones (no literal; as the number format's, part 1 D12).
 * 3. The primary state, a US state code; at least one state of operation, each a code once.
 * 4. A date format and a week start the tab offers, and a fiscal month from 1 to 12.
 * The extra key a change of the states of operation needs is `regionKeyProblem`'s.
 */
export function regionProblem(next: RegionInput, current: Region): string | null {
  if (next.timeZone !== current.timeZone) return REGION_MESSAGES.timeZone;
  if (next.country !== current.country || next.locale !== current.locale)
    return REGION_MESSAGES.countryLocale(current.country, current.locale);
  if (!isStateCode(next.primaryState)) return REGION_MESSAGES.primaryState;
  if (!statesOk(next.statesOfOperation)) return REGION_MESSAGES.statesOfOperation;
  if (!(DATE_FORMATS as readonly string[]).includes(next.dateFormat)) return REGION_MESSAGES.dateFormat;
  if (!(WEEK_STARTS as readonly string[]).includes(next.firstDayOfWeek)) return REGION_MESSAGES.firstDayOfWeek;
  const month = next.fiscalYearStartMonth;
  if (!Number.isInteger(month) || month < 1 || month > 12) return REGION_MESSAGES.fiscalYearStartMonth;
  return null;
}

/**
 * Whether a save changes the states of operation, compared as sets, so a reorder is no change. The
 * company default tax rate applies only in these states (spec rule 25), so a change moves where sales
 * tax is collected and needs Sales tax's key and a step-up (ADR 0059, part 2b, D6).
 */
export function statesOfOperationChanged(
  next: Pick<RegionInput, "statesOfOperation">,
  current: Pick<Region, "statesOfOperation">,
): boolean {
  const was = new Set(current.statesOfOperation);
  const now = new Set(next.statesOfOperation);
  return was.size !== now.size || [...now].some((state) => !was.has(state));
}

/**
 * The one check of the extra key a Region save needs (ADR 0059, part 2b, D6, D19): a change of the
 * states of operation is a tax change, so it also needs every key of the Sales tax tab
 * (`LOCALIZATION_TABS.tax`). The page and DemoStore run it through `localizationTabProblem`; the API
 * answers it as 403.
 */
export function regionKeyProblem(
  next: Pick<RegionInput, "statesOfOperation">,
  current: Pick<Region, "statesOfOperation">,
  holds: HoldsKey,
): string | null {
  return statesOfOperationChanged(next, current) && !LOCALIZATION_TABS.tax.keys.every(holds)
    ? REGION_MESSAGES.statesNeedTax
    : null;
}

/** Whether a rate is plain decimal text above 0 with up to eight decimals (`FX_RATE_TEXT`). */
function isRate(rate: string): boolean {
  return FX_RATE_TEXT.test(rate) && dec(rate).gt(0);
}

/**
 * Why a Currency save can't be stored, or null (blueprint p20 Currency, p21 rules 3 and 4; ADR 0059,
 * part 2b, D7), against the stored currency: the base and its lock stay; the other currencies can't
 * be added, removed, renamed or reordered, because documents in them would need FX postings (rule
 * 3); each rate is plain decimal text above 0. The sent `asOf` is not judged: it is never stored (D8).
 */
export function currencyProblem(next: CurrencyInput, current: Currency): string | null {
  if (next.base !== current.base || next.locked !== current.locked) return CURRENCY_MESSAGES.base(current.base);
  const codes = current.extra.map((entry) => entry.code);
  if (next.extra.length !== codes.length || next.extra.some((entry, i) => entry.code !== codes[i]))
    return CURRENCY_MESSAGES.codes;
  const bad = next.extra.find((entry) => !isRate(entry.rate));
  return bad ? CURRENCY_MESSAGES.exchange(bad.code) : null;
}

/**
 * What a Currency save stores, once `currencyProblem` passed (blueprint "exchange rates by date";
 * ADR 0059, part 2b, D8): the stored base and lock; a rate whose value changed is dated `day`, the
 * company's day, and an unchanged value keeps its stored entry, text and date. The sent `asOf` is
 * never stored.
 */
export function datedRates(next: CurrencyInput, current: Currency, day: string): Currency {
  return {
    base: current.base,
    locked: current.locked,
    extra: next.extra.map((entry, i) => {
      const stored = current.extra[i];
      return stored && sameOptionalDecimal(entry.rate, stored.rate)
        ? stored
        : { code: entry.code, rate: entry.rate, asOf: day };
    }),
  };
}

/** One tab's value and the stored tab, under the tab's key, so reading a property narrows both. */
type TabPair = {
  [K in keyof LocalizationSettings]?: { next: LocalizationSettings[K]; current: LocalizationSettings[K] };
};

/**
 * Why one tab of Localization and tax (or the Sales and documents page) can't be saved, or null,
 * with the API's words: the tab's content rule against the stored tab (`current`), then, for Region,
 * the extra key a change of the states of operation needs (`regionKeyProblem`). The page runs it
 * before any code and DemoStore's `updateLocalization` before it saves; the API answers the content
 * part as 400 and the key as 403 (ADR 0059, parts 2a and 2b). Sales tax runs `taxProblem` against
 * the tab in force (part 3a).
 */
export function localizationTabProblem<T extends keyof LocalizationSettings>(
  tab: T,
  value: LocalizationSettings[T],
  current: LocalizationSettings[T],
  holds: HoldsKey,
): string | null {
  // One key is set, so reading a tab's property narrows both values to that tab's type (as settingsSectionProblem does).
  const pair = { [tab]: { next: value, current } } as TabPair;
  if (pair.documents) return documentsProblem(pair.documents.next);
  if (pair.payroll) return payrollProblem(pair.payroll.next);
  if (pair.region)
    return (
      regionProblem(pair.region.next, pair.region.current) ??
      regionKeyProblem(pair.region.next, pair.region.current, holds)
    );
  if (pair.currency) return currencyProblem(pair.currency.next, pair.currency.current);
  if (pair.tax) return taxProblem(pair.tax.next, pair.tax.current);
  // Every tab is named above; the type still needs a return.
  return null;
}

/**
 * What a tab's save stores beyond what was sent, once `localizationTabProblem` passed (DemoStore's;
 * the API's routes store the same): Currency dates a changed rate with `day` (`datedRates`, ADR 0059,
 * part 2b, D8); Sales tax becomes the tab in force after the save: a changed or new rule or county
 * rate starts on `day`, a changed rule takes the next version, and ended rows go (DemoStore keeps
 * only what is in force; ADR 0059, part 3a, D17); every other tab is stored as sent.
 */
export function localizationTabStored<T extends keyof LocalizationSettings>(
  tab: T,
  value: LocalizationSettings[T],
  current: LocalizationSettings[T],
  day: string,
): LocalizationSettings[T] {
  const pair = { [tab]: { next: value, current } } as TabPair;
  // The branch is the currency tab, so its stored value is that tab's type.
  if (pair.currency) return datedRates(pair.currency.next, pair.currency.current, day) as LocalizationSettings[T];
  // The branch is the tax tab, so its stored value is that tab's type.
  if (pair.tax) return taxChanges(pair.tax.next, pair.tax.current, day).after as LocalizationSettings[T];
  return value;
}
