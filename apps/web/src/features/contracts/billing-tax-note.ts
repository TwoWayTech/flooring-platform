import type { Contract, Customer } from "@workspace/shared";

/**
 * One line saying how sales tax applies to a contract's billings (contracts.md rules 13 and 14),
 * so a billing without tax is never unexplained (click-through #32). Wording only: the rules are
 * unchanged until the accountant answers (ADR 0061, decision 10). The exemption test is the one
 * `taxContextFor` uses: a valid certificate on the day.
 */
export function billingTaxNote(
  contract: Pick<Contract, "direction" | "taxTreatment">,
  customer: Pick<Customer, "taxExempt" | "certificate"> | undefined,
  today: string,
): string {
  if (contract.direction === "subcontractor") return "Sales tax: none on subcontractor bills.";
  if (contract.taxTreatment === "contractor_pays") return "Sales tax: not charged, because the contractor pays it.";
  if (customer?.taxExempt && customer.certificate && customer.certificate.expiresAt >= today) {
    return "Sales tax: not charged, because the customer's resale certificate is on file.";
  }
  if (contract.taxTreatment === "on_release") {
    return "Sales tax: charged on the part billed now; retained money is taxed when it is released.";
  }
  return "Sales tax: charged on each billing's gross at the job site's rate.";
}
