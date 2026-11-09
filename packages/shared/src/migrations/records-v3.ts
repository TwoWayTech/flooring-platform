import { addDays } from "../dates";
import { mapRecords, type Row } from "./map-records";
import type { RecordStep, StoredOverlay, StoredRecords, UpgradeContext } from "./overlay";

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

/** Old supplier terms and the batch 2 term with the same days or the nearest (spec D3). */
const SUPPLIER_TERMS: Readonly<Record<string, string>> = { net_15: "cod", net_45: "net_60", due_on_receipt: "cod" };

/**
 * Purchasing moves to receipts, bills against them and supplier payments (spec D1 to D3). A saved
 * order that was received gets one receipt for everything it ordered (its stock arrived then),
 * a bill points at that receipt and loses its stored paid, and a bill payment becomes a confirmed
 * supplier payment with one allocation.
 */
function upgradePurchasing(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const synthesized: Record<string, Row> = {};
  let next = mapRecords(records, "purchaseOrders", (po: Row) => {
    if ("orderedAt" in po) return po;
    const rest: Row = { ...po };
    delete rest.receivedAt;
    const status = String(po.status);
    const receivedAt = po.receivedAt ? String(po.receivedAt) : null;
    if (receivedAt) {
      const id = `${String(po.id)}-gr`;
      synthesized[id] = {
        id,
        number: `GR-${String(po.number).replace(/\D/g, "")}`,
        poId: po.id,
        supplierId: po.supplierId,
        locationId: po.locationId,
        receivedAt: `${receivedAt}T00:00`,
        receivedById: "",
        receivedBy: "Earlier demo",
        note: "Received in an earlier version of the demo.",
        lines: ((po.lines as Row[]) ?? []).map((l) => ({
          poLineId: l.id,
          productId: l.productId,
          received: l.quantity,
          damaged: "0",
          rolls: [],
        })),
      };
    }
    return {
      ...rest,
      status: status === "draft" ? "draft" : "ordered",
      orderedAt: status === "draft" ? null : String(po.createdAt ?? ""),
      cancelledAt: null,
    };
  });
  if (Object.keys(synthesized).length) next = { ...next, receipts: { ...(next.receipts ?? {}), ...synthesized } };
  next = mapRecords(next, "bills", (bill: Row) => {
    if ("receiptIds" in bill) return bill;
    const rest: Row = { ...bill };
    delete rest.paid;
    const receiptId = `${String(bill.poId)}-gr`;
    const known = next.receipts?.[receiptId] || ctx.base.receipts.some((r) => r.id === receiptId);
    return { ...rest, receiptIds: known ? [receiptId] : [], matchIssues: [], files: [] };
  });
  const old = records.billPayments;
  if (old) {
    const payments: StoredRecords = { ...(next.supplierPayments ?? {}) };
    for (const [id, row] of Object.entries(old)) {
      if (row === null) continue;
      const p = row as Row;
      const date = String(p.at ?? "").slice(0, 10);
      payments[id] = {
        id,
        number: `EARLIER-${id.slice(-6)}`,
        supplierId: p.supplierId,
        date,
        method: "ach",
        reference: "",
        note: "Paid in an earlier version of the demo.",
        files: [],
        allocations: [{ billId: p.billId, amount: p.amount }],
        amount: p.amount,
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
    }
    next = { ...next, supplierPayments: payments };
    delete next.billPayments;
  }
  return mapRecords(next, "suppliers", (supplier: Row) =>
    "creditLimit" in supplier
      ? supplier
      : { ...supplier, terms: SUPPLIER_TERMS[String(supplier.terms)] ?? supplier.terms, creditLimit: "0.00" },
  );
}

/**
 * Upgrade steps from schema version 2 to 3 (feature batch 2, Batch B), run in order. Each step
 * leaves records that already have the new shape alone, so it is safe on any saved version.
 */
export const V3_RECORD_STEPS: RecordStep[] = [upgradeQuoteStatus, upgradeInvoices, upgradePayments, upgradePurchasing];
