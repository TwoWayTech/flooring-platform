import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  customerStatement,
  MAX_PROOF_BYTES,
  overCreditLimit,
  proofFileProblem,
  proofFilesProblem,
  type CompanyFixtures,
} from "../src";

const summit = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "summit.json"), "utf8")) as CompanyFixtures;

const bytes = (text: string) => new TextEncoder().encode(text);

describe("one proof file's problem (click-through #12)", () => {
  it("refuses a text file named .jpg by its first bytes, in the server's words", () => {
    const fake = { name: "fake-photo.jpg", size: 20, head: bytes("just some text here") };
    expect(proofFileProblem(fake)).toBe("fake-photo.jpg is not a PDF, JPG, PNG, WebP or HEIC file.");
    expect(proofFilesProblem([fake])).toBe(proofFileProblem(fake));
  });

  it("accepts a real JPEG and refuses one larger than 5 MB", () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(proofFileProblem({ name: "check.jpg", size: 1000, head })).toBeNull();
    expect(proofFileProblem({ name: "big.jpg", size: MAX_PROOF_BYTES + 1, head })).toBe("big.jpg is larger than 5 MB.");
  });
});

describe("over the credit limit (click-through #18)", () => {
  it("is over only when the open balance exceeds a limit that was set", () => {
    expect(overCreditLimit("66654.75", "11000.00")).toBe(true);
    expect(overCreditLimit("45216.21", "43000.00")).toBe(true);
    expect(overCreditLimit("11000.00", "11000.00")).toBe(false);
    expect(overCreditLimit("500.00", "0.00"), "a limit of zero means none was set").toBe(false);
  });

  it("is never over for a viewer whose limit the server stripped", () => {
    expect(overCreditLimit("66654.75", undefined)).toBe(false);
    expect(overCreditLimit("66654.75", null)).toBe(false);
  });
});

describe("statement lines in date and time order (click-through #19)", () => {
  const invoice = {
    ...summit.invoices[0]!,
    id: "x1",
    number: "INV-X1",
    customerId: "cx",
    total: "838.95",
    issuedAt: "2026-11-20",
    createdAt: "2026-11-20T09:00",
    isReturn: false,
    voidedAt: null,
  };
  const credit = {
    ...invoice,
    id: "x2",
    number: "CR-X2",
    isReturn: true,
    refundedAt: null,
    creditForInvoiceId: "x1",
    total: "104.47",
    issuedAt: "2026-11-21",
    createdAt: "2026-11-21T15:30",
  };
  const deposit = {
    ...summit.payments[0]!,
    id: "p1",
    number: "PAY-D",
    invoiceId: "x1",
    customerId: "cx",
    amount: "419.48",
    status: "confirmed" as const,
    date: "2026-11-21",
    recordedAt: "2026-11-21T10:15",
  };
  const docs = { payments: [deposit], adjustments: [], refunds: [] };

  it("puts a deposit taken in the morning before a credit note issued that afternoon", () => {
    const lines = customerStatement({ ...docs, invoices: [credit, invoice] }, "cx");
    expect(lines.map((l) => l.reference)).toEqual(["INV-X1", "PAY-D for INV-X1", "CR-X2"]);
    expect(lines.map((l) => l.balance)).toEqual(["838.95", "419.47", "315.00"]);
  });

  it("puts a credit note issued before the payment first", () => {
    const early = { ...credit, createdAt: "2026-11-21T08:00" };
    const lines = customerStatement({ ...docs, invoices: [invoice, early] }, "cx");
    expect(lines.map((l) => l.reference)).toEqual(["INV-X1", "CR-X2", "PAY-D for INV-X1"]);
  });

  it("falls back to billed before settled on the same day when a line has no recorded time", () => {
    const untimed = { ...credit, createdAt: undefined };
    const lines = customerStatement({ ...docs, invoices: [invoice, untimed] }, "cx");
    expect(lines.map((l) => l.reference)).toEqual(["INV-X1", "CR-X2", "PAY-D for INV-X1"]);
  });
});
