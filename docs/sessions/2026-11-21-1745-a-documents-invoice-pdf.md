# 2026-11-21 17:45, A: customer documents (invoice and PDF)

Branch `fix/documents-invoice-pdf`. Closes click-through #55, #11, #42 and answers #10 (see the open question).

## Goal
Customer documents must not follow the screen's number display setting, the PDF must print every sign it shows, the terms and due date on an invoice must agree, and "Summit Floor Co.." must not double its period.

## What changed
- `packages/shared/src/numbers.ts`: `currencyDecimals` and `formatDocumentNumber` (money at the currency's precision, unit prices at their stored precision up to 4, quantities and rates at every stored decimal).
- `apps/web/src/features/invoices/invoice-model.ts` (screen article and PDF), `payments/receipt-pdf.tsx`, `purchasing/po-pdf.tsx` use it. CSV exports already wrote stored values (`toCsv`), so they needed no change.
- `apps/web/src/lib/pdf-text.ts`: `pdfText` / `pdfSafe`. The standard Helvetica font encodes WinAnsi only; × – — ’ “ ” • … are in it and print, "≈" was encoded as 0x48 ("H"). Signs outside WinAnsi become words ("about", "-", "<=", "->") or "?". Applied to the invoice, receipt, PO and both report PDFs; the screen keeps "≈".
- `packages/shared/src/operations/quotes.ts`: `invoiceTermsText`. The due-date rule (sales.md rule 21) is unchanged: a plain invoice is already due on the issue date for Due on receipt and issue + N for Net N. INV-1224 was a deposit invoice, whose balance gets the company's 30 balance days on purpose; it now prints "Deposit due on receipt, balance in 30 days" beside the date.
- `packages/shared/src/sentence.ts`: `endSentence`, used in the report PDFs' subtitle, the platform admin access toast, the MFA reset toast, the supplier contact dialog and the invitation emails.

## Checks
See the PR body for the exact runs.

## Open question for the owner
#10: should a deposit invoice for a Due-on-receipt customer be due on the issue date (dropping the "balance days" setting for that case), or keep the balance days as rule 21 says? This PR keeps rule 21 and makes the document say what each part follows. Existing posted invoices are not rewritten either way.
