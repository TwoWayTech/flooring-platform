# ADR 0012: Quote statuses Draft, Pending, Accepted, Converted, Declined, and a derived Expired

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, item B1: quotes need Draft (saved, not sent; only a customer required) → Pending (sent, waiting for the customer, optional expiry date) → Accepted → Converted, or Declined / Expired. Save as draft must work at any point, and sending runs full validation. Quotes had `draft | sent | accepted | invoiced | declined`, no expiry, and no way to change the status in the UI apart from converting.

## Decision
- `QuoteStatus` is `draft | pending | accepted | converted | declined`. `Quote` gains `sentAt` and `expiresAt` (both nullable). **Expired is derived**, never stored: a pending quote whose `expiresAt` is before today (`quoteState` in `packages/shared/src/operations/quote-status.ts`), so moving the date or resending changes it at once.
- The rules live in one shared module: `quoteActions` (draft: send; pending: accept, decline; expired: send again, accept, decline; accepted: decline; converted and declined are closed), `quoteDraftProblem` (a customer), `quoteSendProblems` (customer, at least one line, complete job-site address with a 5-digit ZIP, warehouse, expiry not in the past), `pendingQuotes` for the dashboard figure.
- `ApiClient.saveQuote` saves content only: a new quote is a Draft and the store keeps status, `sentAt`, `expiresAt` and `invoiceId` from the saved record. `updateQuoteStatus(quoteId, { action, expiresAt })` is the one way to change status; it needs `sales.quote.edit`, accepts only the actions `quoteActions` offers, re-runs full validation for send, and writes an audit entry. `convertQuoteToInvoice` accepts any open quote (draft, pending, expired, accepted) after the same validation and marks it Converted.
- A company setting `documents.quoteExpiryDays` (30 by default, Settings → Documents) proposes the expiry date in the Send dialog; the date can be cleared for no expiry.
- Saved data: the overlay schema goes to version 3. Its step renames `sent` → `pending` and `invoiced` → `converted`, and gives a sent quote `sentAt` = its creation date and the default expiry from then. Version 2 data saved under the current key is now upgraded too (`CompanyDb.loadOverlay`), and the upgrade runs the steps of every version after the saved one.
- Fixtures: no new random draws; quotes that left draft were sent the day they were made, so old unanswered quotes read Expired.

## Consequences
- A quote can no longer change status by being saved with a different `status`; the store ignores it.
- Converted and declined quotes are read-only in the builder.
