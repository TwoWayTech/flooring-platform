import {
  agingSummary,
  billLedger,
  boxedStock,
  dec,
  inventoryValuation,
  ledgerIndex,
  openAmounts,
  openingBalancePosting,
  openBillAmounts,
  postingProblem,
  sum,
  type OpeningAmount,
} from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { loadDemoCompany } from "../src/seed/fixtures";
import { OPENING_MEMO, seedOpening } from "../src/seed/opening-balances";

const total = (amounts: readonly OpeningAmount[]) => sum(amounts.map((entry) => entry.amount));

describe("the seed's opening balances, worked out from the fixtures (ADR 0062)", () => {
  const { fixtures } = loadDemoCompany("summit");
  const opening = seedOpening(fixtures)!;
  const today = fixtures.anchorDate;

  it("opens Summit's receivables at the open invoice balances the aging shows", () => {
    const ledgers = ledgerIndex(
      fixtures.invoices,
      { payments: fixtures.payments, adjustments: fixtures.invoiceAdjustments },
      today,
    );
    const aging = agingSummary(openAmounts(fixtures.invoices, ledgers), today);
    expect(total(opening.balances.receivables).toFixed(2)).toBe(aging.total);
    expect(dec(aging.total).gt(0)).toBe(true);
  });

  it("opens payables at the open bill balances and stock at the stock value", () => {
    const ledgers = new Map(
      fixtures.bills.map((bill) => [bill.id, billLedger(bill, fixtures.supplierPayments, today)]),
    );
    const payables = agingSummary(openBillAmounts(fixtures.bills, ledgers), today);
    expect(opening.balances.payables).toBe(payables.total);
    const stock = inventoryValuation(
      fixtures.rolls.filter((roll) => dec(roll.remainingLengthFt).gt(0)),
      fixtures.products,
      boxedStock(fixtures.stockMovements),
    );
    expect(total(opening.balances.inventory).toFixed(2)).toBe(stock.total);
  });

  it("holds the retainage the contract billings withheld", () => {
    const withheld = sum(
      fixtures.contractBillings.filter((b) => b.invoiceId).map((b) => dec(b.withheld).minus(b.released)),
    );
    const subcontract = sum(
      fixtures.contractBillings.filter((b) => b.billId).map((b) => dec(b.withheld).minus(b.released)),
    );
    expect(total(opening.balances.retainageReceivable).toFixed(2)).toBe(withheld.toFixed(2));
    expect(opening.balances.retainagePayable).toBe(subcontract.toFixed(2));
  });

  it("starts with enough cash to pay everything the seed owes, as a whole $10,000", () => {
    const b = opening.balances;
    const owed = sum([
      b.payables,
      b.receivedNotBilled,
      b.retainagePayable,
      total(b.customerCredit),
      ...fixtures.contractorPayments.filter((p) => p.status === "approved").map((p) => p.amount),
    ]);
    const cash = dec(b.cash);
    expect(cash.gte(owed)).toBe(true);
    expect(cash.minus(owed).lt(10000)).toBe(true);
    expect(cash.mod(10000).isZero()).toBe(true);
  });

  it("is one balanced entry, dated the day before the earliest open document", () => {
    const draft = openingBalancePosting({ id: "x", date: opening.date, memo: OPENING_MEMO }, opening.balances);
    expect(postingProblem(draft.lines)).toBeNull();
    expect(draft.lines.some((line) => line.account === "opening_balance_equity")).toBe(true);
    expect(opening.date < fixtures.anchorDate).toBe(true);
    expect(opening.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("opens Harbor (HR Suite) with cash for its approved contractor payments only", () => {
    const harbor = seedOpening(loadDemoCompany("harbor").fixtures)!;
    const b = harbor.balances;
    expect([b.receivables, b.inventory, b.retainageReceivable, b.customerCredit].every((x) => x.length === 0)).toBe(
      true,
    );
    expect([b.payables, b.receivedNotBilled, b.retainagePayable]).toEqual(["0.00", "0.00", "0.00"]);
    expect(dec(b.cash).gt(0)).toBe(true);
    expect(b.holdsSubcontractBill).toBe(false);
  });

  it("marks the entry as holding contract cost when an open or retaining bill is a subcontract bill", () => {
    expect(opening.balances.holdsSubcontractBill).toBe(true);
    // Without its subcontract bills Summit's opening payables reveal no contract cost.
    const plain = { ...fixtures, bills: fixtures.bills.filter((bill) => !bill.contractId) };
    expect(seedOpening(plain)!.balances.holdsSubcontractBill).toBe(false);
    // A subcontract bill still owed counts even when it withheld no retainage.
    const noRetainage = {
      ...fixtures,
      bills: fixtures.bills.map((bill) => (bill.contractId ? { ...bill, retainageWithheld: "0.00" } : bill)),
    };
    const owed = seedOpening(noRetainage)!.balances;
    expect(owed.retainagePayable).toBe("0.00");
    expect(owed.holdsSubcontractBill).toBe(true);
  });
});
