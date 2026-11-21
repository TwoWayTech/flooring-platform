import { describe, expect, it } from "vitest";
import { invoiceLedger, type Invoice } from "@workspace/shared";
import { queueSummary, recordedByViewer } from "@/features/finance/payments-queue-words";
import { summaryFigures } from "@/features/invoices/invoice-summary";
import { checkPickedProofFiles } from "@/features/invoices/payments/check-proof-files";
import { balanceAfterLabel } from "@/features/invoices/payments/payment-words";
import { stockIssueWords } from "@/features/invoices/stock-issue-words";
import { ApiError } from "@/lib/api/errors";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { HttpApiError } from "@/lib/api/http/transport";
import { retryCanHelp, retryToast } from "@/lib/api/retry";

const PDF = () => new File(["%PDF-1.4\n%demo\n"], "bank-confirmation.pdf", { type: "application/pdf" });
const FAKE_JPG = () => new File(["just some text, not a photo"], "fake-photo.jpg", { type: "image/jpeg" });

describe("proof files are checked when picked (click-through #12)", () => {
  it("refuses a text file renamed .jpg inline and keeps the real PDF", async () => {
    const checked = await checkPickedProofFiles(0, [FAKE_JPG(), PDF()]);
    expect(checked.accepted.map((f) => f.name)).toEqual(["bank-confirmation.pdf"]);
    expect(checked.refused).toEqual(["fake-photo.jpg is not a PDF, JPG, PNG, WebP or HEIC file. It was not attached."]);
  });

  it("leaves out files beyond three, saying why", async () => {
    const checked = await checkPickedProofFiles(2, [PDF(), PDF()]);
    expect(checked.accepted).toHaveLength(1);
    expect(checked.refused).toEqual(["bank-confirmation.pdf was not attached: attach at most 3 files."]);
  });
});

describe("Try again only when a retry could help (click-through #12)", () => {
  it("offers no retry for refusals", () => {
    expect(retryCanHelp(new DemoRuleError("fake-photo.jpg is not a PDF"))).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(retryCanHelp(new HttpApiError("Refused", status, "rule_broken")), String(status)).toBe(false);
    }
    expect(retryToast(new HttpApiError("Refused", 422, "rule_broken"), () => undefined)).toEqual({});
  });

  it("offers a retry when the request itself failed", () => {
    for (const status of [0, 408, 429, 500, 503]) {
      expect(retryCanHelp(new HttpApiError("Failed", status, "x")), String(status)).toBe(true);
    }
    expect(retryCanHelp(new ApiError("You are offline."))).toBe(true);
    expect(retryCanHelp(new TypeError("Failed to fetch"))).toBe(true);
    expect(retryToast(new TypeError("Failed to fetch"), () => undefined).action?.label).toBe("Try again");
  });
});

describe("Record payment preview (click-through #14)", () => {
  it("names the balance after verification for a payment that waits", () => {
    expect(balanceAfterLabel(true)).toBe("Balance after verification");
    expect(balanceAfterLabel(false)).toBe("Balance after");
  });
});

describe("invoice summary figures add up (click-through #16)", () => {
  const invoice = {
    id: "inv-1",
    total: "838.95",
    voidedAt: null,
    isReturn: false,
    dueAt: "2026-12-21",
    depositPct: "50",
  } satisfies Pick<Invoice, "id" | "total" | "voidedAt" | "isReturn" | "dueAt" | "depositPct">;
  const day = "2026-11-21";

  it("shows Credits between Paid and Remaining once a credit is applied", () => {
    const ledger = invoiceLedger(
      invoice,
      {
        payments: [{ invoiceId: "inv-1", status: "confirmed", amount: "419.48", date: day, kind: "deposit" }],
        adjustments: [{ invoiceId: "inv-1", kind: "credit_applied", amount: "104.47", at: `${day}T15:30` }],
      },
      day,
    );
    expect(summaryFigures(ledger)).toEqual([
      { label: "Total", value: "838.95" },
      { label: "Paid", value: "419.48" },
      { label: "Credits", value: "104.47" },
      { label: "Remaining", value: "315.00", large: true },
    ]);
  });

  it("keeps the three figures when there is no credit or write-off", () => {
    const ledger = invoiceLedger(invoice, { payments: [], adjustments: [] }, day);
    expect(summaryFigures(ledger).map((f) => f.label)).toEqual(["Total", "Paid", "Remaining"]);
  });
});

describe("cut confirmation words (click-through #17)", () => {
  it("names the formatted length and the roll", () => {
    const words = stockIssueWords({ quantity: "12.54", unit: "ft", rollNumber: "NM-6016", invoiceNumber: "INV-1220" });
    expect(words.title).toBe("Cut 12.54 ft from roll NM-6016?");
    expect(words.description).toContain("can't be undone");
    expect(words.confirmLabel).toBe("Cut 12.54 ft");
    expect(words.done).toBe("Cut 12.54 ft from roll NM-6016 for INV-1220");
  });

  it("speaks of issuing for stock without a roll", () => {
    const words = stockIssueWords({ quantity: "120.00", unit: "sq ft", rollNumber: null, invoiceNumber: "INV-1" });
    expect(words.title).toBe("Issue 120.00 sq ft?");
    expect(words.done).toBe("Issued 120.00 sq ft for INV-1");
  });
});

describe("Payments to verify (click-through #36)", () => {
  const rows = [{ recordedById: "dana" }, { recordedById: "ana" }, { recordedById: "ana" }, { recordedById: "luis" }];

  it("counts only what this person can verify and names their own", () => {
    expect(queueSummary(rows, "dana")).toBe(
      "3 waiting for you to check. 1 you recorded waits for someone else to verify.",
    );
    expect(queueSummary(rows, "ana")).toBe(
      "2 waiting for you to check. 2 you recorded wait for someone else to verify.",
    );
    expect(queueSummary(rows, "pat")).toBe("4 waiting for you to check.");
  });

  it("marks one's own payment the same way for every role", () => {
    expect(rows.map((r) => recordedByViewer(r, "dana"))).toEqual([true, false, false, false]);
  });
});
