import {
  CATEGORY_LABELS,
  CURRENCY_MESSAGES,
  DOCUMENT_MESSAGES,
  LEGAL_FOOTER_MAX,
  NUMBER_KINDS,
  NUMBER_MESSAGES,
  numbersFromWire,
  PAYROLL_MESSAGES,
  REGION_MESSAGES,
  WASTE_CATEGORIES,
  type CompanyProfile,
  type CurrencyInput,
  type DocumentsInput,
  type ExpenseSettings,
  type NumberKind,
  type NumberSettings,
  type PaymentSettings,
  type PayrollInput,
  type RegionInput,
} from "@workspace/shared";
import { z } from "zod";

/**
 * The bodies of `PUT /settings/<section>` (ADR 0059): types, lengths and no unknown field at any
 * level (`.strict()`). What a value means is checked after this by the shared content rules
 * (`settingsSectionProblem`), so both modes refuse it with the same words. Strings are taken as
 * sent: the rules trim to check, and the value is stored as typed. Amounts are always strings, never
 * JSON numbers (CLAUDE.md rule 6); the number format's decimals are counts of places, not amounts.
 */

const KINDS = Object.keys(NUMBER_KINDS) as [NumberKind, ...NumberKind[]];

/** A company profile as Settings → Company profile sends it. */
export const PROFILE_INPUT: z.ZodType<CompanyProfile> = z
  .object({
    legalName: z.string().max(200),
    dba: z.string().max(200),
    ein: z.string().max(20),
    phone: z.string().max(50),
    email: z.string().max(320),
    website: z.string().max(200),
    address: z
      .object({
        street: z.string().max(200),
        city: z.string().max(100),
        state: z.string().max(2),
        zip: z.string().max(10),
        county: z.string().max(100).optional(),
        lat: z.number().finite().optional(),
        lng: z.number().finite().optional(),
      })
      .strict(),
  })
  .strict();

/**
 * The number format as it travels (`NumberSettingsWire`), read into the stored shape. Every kind
 * must come exactly once; only then is the list turned into the record, so nothing is filled in.
 */
export const NUMBERS_INPUT: z.ZodType<NumberSettings> = z
  .object({
    decimals: z
      .array(z.object({ kind: z.enum(KINDS), places: z.number().int() }).strict())
      .max(KINDS.length, NUMBER_MESSAGES.kindsOnce)
      .superRefine((list, context) => {
        const given = new Set(list.map((entry) => entry.kind));
        if (given.size !== list.length || KINDS.some((kind) => !given.has(kind)))
          context.addIssue({ code: "custom", message: NUMBER_MESSAGES.kindsOnce });
      }),
    negativeStyle: z.enum(["minus", "parens"]),
    compactDashboards: z.boolean(),
    locale: z.string().max(20),
    currency: z.string().max(3),
  })
  .strict()
  .transform(numbersFromWire);

/** Payment rules as Settings → Payments sends them. */
export const PAYMENTS_INPUT: z.ZodType<PaymentSettings> = z
  .object({
    approvalRequired: z.boolean(),
    approvalThreshold: z.string().max(20),
    writeOffMax: z.string().max(20),
    paymentPrefix: z.string().max(10),
    refundPrefix: z.string().max(10),
  })
  .strict();

/** Expense approval as Settings → Expenses sends it. */
export const EXPENSES_INPUT: z.ZodType<ExpenseSettings> = z
  .object({ approvalRequired: z.boolean(), approvalThreshold: z.string().max(20) })
  .strict();

/**
 * The legal footer's outer bound: ten times the shared `LEGAL_FOOTER_MAX`, so a footer of any length
 * a person types reaches `documentsProblem`, which names it in its own order (review round 1).
 */
const FOOTER_GUARD = 10 * LEGAL_FOOTER_MAX;

/**
 * A default waste value's words past its outer bound, as `documentsProblem` gives them: its
 * category's, or the categories' words for a key that is not a waste category.
 */
function wasteWords(path: readonly PropertyKey[] | undefined): string {
  const category = WASTE_CATEGORIES.find((known) => known === path?.at(-1));
  return category ? DOCUMENT_MESSAGES.waste(CATEGORY_LABELS[category]) : DOCUMENT_MESSAGES.wasteCategories;
}

/**
 * Sales and documents as the page sends it (ADR 0059, part 2a). Only types, outer lengths and
 * unknown fields are checked here; the terms, percents, days, waste categories, prefixes and the
 * footer's length are the shared rule's to judge (`documentsProblem`), so both modes refuse them with
 * the same words. Each outer length carries its field's shared words, and the page's inputs stop at
 * the rule's lengths, so a person never meets one (review round 1). Percents are strings, never JSON numbers.
 */
export const DOCUMENTS_INPUT: z.ZodType<DocumentsInput> = z
  .object({
    defaultTerms: z.string().max(20, DOCUMENT_MESSAGES.defaultTerms),
    lateFeePct: z.string().max(20, DOCUMENT_MESSAGES.lateFeePct),
    quotePrefix: z.string().max(20, DOCUMENT_MESSAGES.quotePrefix),
    invoicePrefix: z.string().max(20, DOCUMENT_MESSAGES.invoicePrefix),
    poPrefix: z.string().max(20, DOCUMENT_MESSAGES.poPrefix),
    legalFooter: z.string().max(FOOTER_GUARD, DOCUMENT_MESSAGES.legalFooter),
    defaultDepositPct: z.string().max(20, DOCUMENT_MESSAGES.defaultDepositPct),
    quoteExpiryDays: z.number(),
    balanceDueDays: z.number(),
    defaultWastePct: z
      .record(
        z.string().max(40, DOCUMENT_MESSAGES.wasteCategories),
        z.string().max(20, { error: (issue) => wasteWords(issue.path) }),
      )
      .refine((map) => Object.keys(map).length <= 20, DOCUMENT_MESSAGES.wasteCategories),
  })
  .strict();

/**
 * Payroll rules as the tab sends them; the overtime rule and the state are the shared rule's to judge
 * (`payrollProblem`), and their outer lengths carry its words.
 */
export const PAYROLL_INPUT: z.ZodType<PayrollInput> = z
  .object({
    overtimeRule: z.string().max(20, PAYROLL_MESSAGES.overtimeRule),
    holidayState: z.string().max(20, PAYROLL_MESSAGES.holidayState),
  })
  .strict();

/**
 * Region as the tab sends it (ADR 0059, part 2b). Only types, outer lengths and unknown fields are
 * checked here; every value, the zone included, is the shared rule's to judge (`regionProblem`), so
 * both modes refuse it with the same words. Each outer length carries its field's words (part 2a's
 * review round 1). Country and locale take none: the rule's words name the stored values, which this
 * check can't know; the rule takes only the stored values, so nothing longer is ever stored; and the
 * JSON body limit bounds the request (part 2b, D23).
 */
export const REGION_INPUT: z.ZodType<RegionInput> = z
  .object({
    country: z.string(),
    primaryState: z.string().max(10, REGION_MESSAGES.primaryState),
    statesOfOperation: z
      .array(z.string().max(10, REGION_MESSAGES.statesOfOperation))
      .max(100, REGION_MESSAGES.statesOfOperation),
    timeZone: z.string().max(64, REGION_MESSAGES.timeZone),
    locale: z.string(),
    dateFormat: z.string().max(20, REGION_MESSAGES.dateFormat),
    firstDayOfWeek: z.string().max(20, REGION_MESSAGES.firstDayOfWeek),
    fiscalYearStartMonth: z.number(),
  })
  .strict();

/**
 * Currency as the tab sends it (ADR 0059, part 2b). Rates are strings, never JSON numbers (CLAUDE.md
 * rule 6). The base and the rates take no outer length: the rule's words name the stored base and
 * each rate's code, which this check can't know; only the stored base and rates `FX_RATE_TEXT` takes
 * are ever stored; and the JSON body limit bounds the request (D23). `asOf` is taken for its shape
 * only: the save dates rates itself and never stores it (D8).
 */
export const CURRENCY_INPUT: z.ZodType<CurrencyInput> = z
  .object({
    base: z.string(),
    locked: z.boolean(),
    extra: z
      .array(
        z.object({ code: z.string().max(10, CURRENCY_MESSAGES.codes), rate: z.string(), asOf: z.string() }).strict(),
      )
      .max(50, CURRENCY_MESSAGES.codes),
  })
  .strict();
