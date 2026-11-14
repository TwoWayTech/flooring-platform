import { retainageProblem } from "../src";
import { describe, expect, it } from "vitest";
import {
  contractBillPosting,
  contractInvoicePosting,
  DEFAULT_ACCOUNTS,
  dec,
  moneyString,
  postingProblem,
  type BillingRef,
} from "../src";

const sides = (lines: { account: string; debit: string; credit: string }[]) =>
  lines.map((entry) => [entry.account, entry.debit, entry.credit]);

const progress: BillingRef = { id: "cbl-1", contractNumber: "CTR-1001", number: 2, kind: "progress" };
const release: BillingRef = { ...progress, number: 3, kind: "release" };

/** An invoice's figures as contractInvoice makes them: total = subtotal + tax - withheld + released. */
function invoice(subtotal: string, tax: string, withheld: string, released: string) {
  const total = dec(subtotal).plus(tax).minus(withheld).plus(released);
  return {
    number: "INV-1240",
    issuedAt: "2026-11-14",
    customerId: "cus-1",
    locationId: "loc-denver",
    subtotal,
    tax,
    total: moneyString(total),
    retainageWithheld: withheld,
    retainageReleased: released,
  };
}

/** A bill's figures as contractBill makes them: total = gross - withheld + released. */
function bill(gross: string, withheld: string, released: string) {
  return {
    number: "CTR-1004-2",
    issuedAt: "2026-11-14",
    total: moneyString(dec(gross).minus(withheld).plus(released)),
    gross,
    retainageWithheld: withheld,
    retainageReleased: released,
    supplierName: "Peak Install Crew",
  };
}

/** Contract billing postings (contracts.md rules 12 to 14; ADR 0045). */
describe("contract billing postings", () => {
  it("adds the retainage accounts to the default chart", () => {
    expect(DEFAULT_ACCOUNTS).toContainEqual({
      key: "retainage_receivable",
      code: "1150",
      name: "Retainage Receivable",
      type: "asset",
    });
    expect(DEFAULT_ACCOUNTS).toContainEqual({
      key: "retainage_payable",
      code: "2150",
      name: "Retainage Payable",
      type: "liability",
    });
    expect(new Set(DEFAULT_ACCOUNTS.map((account) => account.code)).size).toBe(DEFAULT_ACCOUNTS.length);
  });

  it("posts a progress invoice: receivable and retainage held against sales and tax", () => {
    const draft = contractInvoicePosting(progress, invoice("30000.00", "2643.00", "1500.00", "0.00"));
    expect(sides(draft.lines)).toEqual([
      ["accounts_receivable", "31143.00", "0.00"],
      ["retainage_receivable", "1500.00", "0.00"],
      ["sales", "0.00", "30000.00"],
      ["sales_tax_payable", "0.00", "2643.00"],
    ]);
    expect(draft.lines.find((line) => line.account === "sales")!.locationId).toBe("loc-denver");
    expect(draft.lines.every((line) => line.customerId === "cus-1")).toBe(true);
    expect(draft).toMatchObject({
      event: "contract_billing.posted",
      sourceType: "contract_billing",
      sourceId: "cbl-1",
      sourceNumber: "INV-1240",
      date: "2026-11-14",
      memo: "Contract billing CTR-1001 #2, invoice INV-1240",
    });
    expect(postingProblem(draft.lines)).toBeNull();
  });

  it("posts a release invoice: retainage moves to receivables, with tax when the treatment puts it there", () => {
    expect(sides(contractInvoicePosting(release, invoice("0.00", "0.00", "0.00", "1800.00")).lines)).toEqual([
      ["accounts_receivable", "1800.00", "0.00"],
      ["retainage_receivable", "0.00", "1800.00"],
    ]);
    const taxed = contractInvoicePosting(release, invoice("0.00", "158.58", "0.00", "1800.00"));
    expect(sides(taxed.lines)).toEqual([
      ["accounts_receivable", "1958.58", "0.00"],
      ["retainage_receivable", "0.00", "1800.00"],
      ["sales_tax_payable", "0.00", "158.58"],
    ]);
    expect(taxed.memo).toBe("Retainage release CTR-1001 #3, invoice INV-1240");
  });

  it("posts a subcontract bill: job cost against payables and retainage payable", () => {
    const draft = contractBillPosting(progress, bill("7400.00", "370.00", "0.00"), "loc-denver");
    expect(sides(draft.lines)).toEqual([
      ["cost_of_goods_sold", "7400.00", "0.00"],
      ["accounts_payable", "0.00", "7030.00"],
      ["retainage_payable", "0.00", "370.00"],
    ]);
    expect(draft.lines[0]!.locationId).toBe("loc-denver");
    expect(draft.sourceNumber).toBe("CTR-1004-2");
    expect(draft.memo).toBe("Contract billing CTR-1001 #2, bill CTR-1004-2 from Peak Install Crew");
  });

  it("posts a subcontract release: retainage payable moves to payables", () => {
    expect(sides(contractBillPosting(release, bill("0.00", "0.00", "370.00"), "loc-denver").lines)).toEqual([
      ["retainage_payable", "370.00", "0.00"],
      ["accounts_payable", "0.00", "370.00"],
    ]);
  });

  it("moves a negative amount from a lower cumulative figure to the other side", () => {
    const lower = contractInvoicePosting(progress, invoice("-1000.00", "-88.10", "-50.00", "0.00"));
    expect(sides(lower.lines)).toEqual([
      ["accounts_receivable", "0.00", "1038.10"],
      ["retainage_receivable", "0.00", "50.00"],
      ["sales", "1000.00", "0.00"],
      ["sales_tax_payable", "88.10", "0.00"],
    ]);
    expect(postingProblem(lower.lines)).toBeNull();
    const lowerBill = contractBillPosting(progress, bill("-1000.00", "-50.00", "0.00"), "loc-denver");
    expect(postingProblem(lowerBill.lines)).toBeNull();
  });

  it("balances for every combination of gross, withheld, released and tax", () => {
    const amounts = ["0.00", "0.01", "125.37", "36000.00", "-412.50"];
    for (const gross of amounts) {
      for (const withheld of amounts) {
        for (const released of amounts) {
          for (const tax of ["0.00", "3171.60", "0.03", "-36.34"]) {
            const ref = dec(released).isZero() ? progress : release;
            const posted = contractInvoicePosting(ref, invoice(gross, tax, withheld, released)).lines;
            const billed = contractBillPosting(ref, bill(gross, withheld, released), "loc-denver").lines;
            for (const lines of [posted, billed]) {
              // An entry with fewer than two lines is all zero, which LedgerService skips.
              if (lines.length === 0) continue;
              expect(postingProblem(lines), `${gross}/${withheld}/${released}/${tax}`).toBeNull();
            }
          }
        }
      }
    }
  });
});

describe("retainage after a release", () => {
  it("refuses lowering a line below the retainage it still holds", () => {
    const line = { id: "A", code: "A", scheduledValue: "10000.00" } as never;
    const progress = {
      id: "b1",
      number: 1,
      kind: "progress",
      status: "posted",
      lines: [
        {
          lineId: "A",
          completedToDate: "10000.00",
          storedBalance: "0.00",
          retainagePct: "10",
          storedRetainagePct: "10",
        },
      ],
      releases: [],
    };
    const release = {
      id: "b2",
      number: 2,
      kind: "release",
      status: "posted",
      lines: [],
      releases: [{ lineId: "A", amount: "1000.00" }],
    };
    const lower = [
      { lineId: "A", completedToDate: "5000.00", storedBalance: "0.00", retainagePct: "10", storedRetainagePct: "10" },
    ];
    expect(retainageProblem(lower as never, [line], [progress, release] as never)).toMatch(/already released/);
    expect(retainageProblem(lower as never, [line], [progress] as never)).toBeNull();
  });
});
