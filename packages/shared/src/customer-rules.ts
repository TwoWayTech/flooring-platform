import { PAYMENT_TERM_LABELS } from "./operations/quotes";
import { PROFILE_MESSAGES } from "./settings/section-rules";
import type { PaymentTerms } from "./types";
import { ZIP_PATTERN } from "./us-pack/states";

/** Every payment term a customer may have, in the order the form and the import list them. */
export const PAYMENT_TERMS = Object.keys(PAYMENT_TERM_LABELS) as [PaymentTerms, ...PaymentTerms[]];

/**
 * What the customer form and the customer import say about a ZIP or payment terms they refuse:
 * the same words in both (click-through #51). A ZIP is a US one, 5 digits or 5+4 (spec A6, G1).
 */
export const CUSTOMER_FIELD_MESSAGES = {
  zip: PROFILE_MESSAGES.zip,
  terms: `Use one of the payment terms: ${Object.values(PAYMENT_TERM_LABELS).join(", ")}.`,
} as const;

/** Why a ZIP can't be stored, or null for a US ZIP of 5 digits or 5+4 (spec A6, G1). */
export function zipProblem(zip: string): string | null {
  return ZIP_PATTERN.test(zip.trim()) ? null : CUSTOMER_FIELD_MESSAGES.zip;
}
