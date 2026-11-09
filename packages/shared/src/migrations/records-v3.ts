import { addDays } from "../dates";
import { mapRecords, type Row } from "./map-records";
import type { RecordStep, StoredOverlay, UpgradeContext } from "./overlay";

/** Old quote statuses and the batch 2 status they became (spec B1). */
const QUOTE_STATUS: Readonly<Record<string, string>> = { sent: "pending", invoiced: "converted" };

/**
 * Quotes move to Draft / Pending / Accepted / Converted / Declined (spec B1). A quote that had been
 * sent was sent the day it was made and gets the company's default expiry from then, so an old
 * unanswered quote reads Expired, as it would have in the new demo.
 */
function upgradeQuoteStatus(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const expiryDays = ctx.base.settings.localization.documents.quoteExpiryDays;
  return mapRecords(records, "quotes", (quote: Row) => {
    if ("sentAt" in quote) return quote;
    const status = QUOTE_STATUS[String(quote.status)] ?? String(quote.status);
    const created = String(quote.createdAt ?? "").slice(0, 10);
    const sent = status !== "draft" && created !== "";
    return {
      ...quote,
      status,
      sentAt: sent ? created : null,
      expiresAt: sent ? addDays(created, expiryDays) : null,
    };
  });
}

/**
 * Invoices stop storing status and paid (spec Appendix A "Core rule"): both come from payments
 * now. An invoice saved by the old demo keeps its lifecycle: it was sent when issued, a void one
 * keeps its date as the void date, and its deposit comes from its quote. The old demo never
 * recorded payments for invoices it created, so their derived status equals the stored one.
 */
function upgradeInvoices(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const quoteDeposit = (quoteId: unknown) => {
    const saved = records.quotes?.[String(quoteId)] as Row | null | undefined;
    const base = ctx.base.quotes.find((q) => q.id === quoteId);
    return String(saved?.depositPct ?? base?.depositPct ?? "0");
  };
  return mapRecords(records, "invoices", (invoice: Row) => {
    if ("sentAt" in invoice) return invoice;
    const rest: Row = { ...invoice };
    delete rest.status;
    delete rest.paid;
    const status = invoice.status;
    const issued = String(invoice.issuedAt ?? "");
    const isReturn = invoice.isReturn === true;
    return {
      ...rest,
      createdBy: String(invoice.salesRepId ?? ""),
      sentAt: issued || null,
      sentBy: String(invoice.salesRepId ?? "") || null,
      voidedAt: status === "void" ? issued : null,
      voidReason: status === "void" ? "Voided in an earlier demo" : null,
      depositPct: isReturn ? "0" : quoteDeposit(invoice.quoteId),
      creditForInvoiceId: null,
      refundedAt: isReturn ? issued : null,
    };
  });
}

/**
 * A payment saved by an older demo (date in `at`, no number or proof) becomes a confirmed payment
 * with an EARLIER- number, so the records it already counted keep counting.
 */
function upgradePayments(records: StoredOverlay["records"]): StoredOverlay["records"] {
  return mapRecords(records, "payments", (payment: Row) => {
    if ("number" in payment) return payment;
    const rest: Row = { ...payment };
    delete rest.at;
    const date = String(payment.at ?? "").slice(0, 10);
    return {
      ...rest,
      number: `EARLIER-${String(payment.id).slice(-6)}`,
      kind: "payment",
      date,
      checkNumber: "",
      cardLast4: "",
      reference: "",
      note: "Recorded in an earlier version of the demo.",
      files: [],
      status: "confirmed",
      recordedById: "",
      recordedBy: "Earlier demo",
      recordedAt: `${date}T00:00`,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
    };
  });
}

/**
 * Upgrade steps from schema version 2 to 3 (feature batch 2, Batch B), run in order. Each step
 * leaves records that already have the new shape alone, so it is safe on any saved version.
 */
export const V3_RECORD_STEPS: RecordStep[] = [upgradeQuoteStatus, upgradeInvoices, upgradePayments];
