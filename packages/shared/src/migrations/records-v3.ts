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
 * Upgrade steps from schema version 2 to 3 (feature batch 2, Batch B), run in order. Each step
 * leaves records that already have the new shape alone, so it is safe on any saved version.
 */
export const V3_RECORD_STEPS: RecordStep[] = [upgradeQuoteStatus];
