import {
  DOCUMENT_MESSAGES,
  LEGAL_FOOTER_MAX,
  NUMBER_KINDS,
  NUMBER_MESSAGES,
  numbersFromWire,
  type CompanyProfile,
  type DocumentsInput,
  type ExpenseSettings,
  type NumberKind,
  type NumberSettings,
  type PaymentSettings,
  type PayrollInput,
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
 * Sales and documents as the page sends it (ADR 0059, part 2a). Only types, outer lengths and
 * unknown fields are checked here; the terms, percents, days, waste categories and prefixes are the
 * shared rule's to judge (`documentsProblem`), so both modes refuse them with the same words. The
 * footer's bound is the shared one, with the shared words. Percents are strings, never JSON numbers.
 */
export const DOCUMENTS_INPUT: z.ZodType<DocumentsInput> = z
  .object({
    defaultTerms: z.string().max(20),
    lateFeePct: z.string().max(20),
    quotePrefix: z.string().max(20),
    invoicePrefix: z.string().max(20),
    poPrefix: z.string().max(20),
    legalFooter: z.string().max(LEGAL_FOOTER_MAX, DOCUMENT_MESSAGES.legalFooter),
    defaultDepositPct: z.string().max(20),
    quoteExpiryDays: z.number(),
    balanceDueDays: z.number(),
    defaultWastePct: z
      .record(z.string().max(40), z.string().max(20))
      .refine((map) => Object.keys(map).length <= 20, DOCUMENT_MESSAGES.wasteCategories),
  })
  .strict();

/** Payroll rules as the tab sends them; the overtime rule and the state are the shared rule's to judge (`payrollProblem`). */
export const PAYROLL_INPUT: z.ZodType<PayrollInput> = z
  .object({ overtimeRule: z.string().max(20), holidayState: z.string().max(20) })
  .strict();
