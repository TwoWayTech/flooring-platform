import { describe, expect, it } from "vitest";
import { paymentControlsLoosened, type PaymentSettings } from "../src";

const STORED: PaymentSettings = {
  approvalRequired: true,
  approvalThreshold: "1000.00",
  writeOffMax: "5.00",
  paymentPrefix: "PAY-",
  refundPrefix: "RF-",
};

const loosened = (patch: Partial<PaymentSettings>, current: PaymentSettings = STORED) =>
  paymentControlsLoosened({ ...current, ...patch }, current);

describe("payment controls only an Owner may loosen (ADR 0059 2026-11-20, PR #51 Q10)", () => {
  it("PC1 switching the two-person check off loosens; on does not", () => {
    expect(loosened({ approvalRequired: false })).toBe(true);
    expect(loosened({ approvalRequired: true }, { ...STORED, approvalRequired: false })).toBe(false);
  });

  it("PC2 a higher approval amount, or one where every payment waited, loosens", () => {
    expect(loosened({ approvalThreshold: "1000.01" })).toBe(true);
    expect(loosened({ approvalThreshold: "50" }, { ...STORED, approvalThreshold: "" })).toBe(true);
  });

  it("PC3 a lower or equal approval amount, or an empty one, does not", () => {
    expect(loosened({ approvalThreshold: "999.99" })).toBe(false);
    expect(loosened({ approvalThreshold: "1000" })).toBe(false);
    expect(loosened({ approvalThreshold: "" })).toBe(false);
  });

  it("PC4 a higher or empty write-off limit loosens; lower does not", () => {
    expect(loosened({ writeOffMax: "5.01" })).toBe(true);
    expect(loosened({ writeOffMax: "" })).toBe(true);
    expect(loosened({ writeOffMax: "0" })).toBe(false);
    expect(loosened({ writeOffMax: "5" })).toBe(false);
    expect(loosened({ writeOffMax: "10.00" }, { ...STORED, writeOffMax: "" })).toBe(false);
  });

  it("PC6 while the check is off its amount loosens nothing, and switching it on with any amount tightens", () => {
    const off = { ...STORED, approvalRequired: false, approvalThreshold: "" };
    expect(loosened({ approvalRequired: true, approvalThreshold: "1000.00" }, off)).toBe(false);
    expect(loosened({ approvalThreshold: "5000.00" }, off)).toBe(false);
    expect(loosened({ approvalThreshold: "5000.00" }, { ...off, approvalThreshold: "10.00" })).toBe(false);
  });

  it("PC5 prefixes alone never loosen", () => {
    expect(loosened({ paymentPrefix: "P-", refundPrefix: "R-" })).toBe(false);
  });
});
