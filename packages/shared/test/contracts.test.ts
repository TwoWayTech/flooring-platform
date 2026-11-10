import { describe, expect, it } from "vitest";
import {
  allocateRelease,
  billingFigures,
  billingProblem,
  changeOrderProblem,
  closeProblem,
  contractDisplayStatus,
  contractFigures,
  contractReminders,
  dec,
  draftProblem,
  form1099Threshold,
  heldByLine,
  insuranceStatus,
  moneyString,
  retainageWarning,
  waiverProblem,
  type BillingLine,
  type ChangeOrder,
  type Contract,
  type ContractBilling,
  type ContractLine,
  type InsuranceCertificate,
} from "../src";

const contract = (patch: Partial<Contract> = {}): Contract =>
  ({
    id: "c1",
    kind: "project",
    title: "Ridgeline",
    customerId: "cu",
    supplierId: null,
    status: "active",
    startsAt: "2026-01-01",
    endsAt: "2026-12-31",
    originalValue: "120000.00",
    retainagePct: "10",
    storedRetainagePct: "10",
    renewal: { mode: "none", noticeDays: 30 },
    ...patch,
  }) as Contract;
const line = (id: string, value: string, patch: Partial<ContractLine> = {}): ContractLine =>
  ({
    id,
    contractId: "c1",
    code: id,
    description: id,
    category: "material",
    billing: "percent",
    scheduledValue: value,
    retainagePct: null,
    storedRetainagePct: null,
    milestoneDueAt: null,
    changeOrderId: null,
    estimatedCost: "0",
    ...patch,
  }) as ContractLine;
const input = (lineId: string, completed: string, stored = "0", rate = "10"): BillingLine => ({
  lineId,
  completedToDate: completed,
  storedBalance: stored,
  retainagePct: rate,
  storedRetainagePct: rate,
});

/** Posts billings in order, each computed against the ones before, as the store does. */
function post(sets: BillingLine[][]): ContractBilling[] {
  const done: ContractBilling[] = [];
  sets.forEach((lines, i) => {
    const f = billingFigures(lines, done);
    done.push({
      id: `b${i}`,
      contractId: "c1",
      number: i + 1,
      kind: "progress",
      periodEnd: "2026-06-30",
      status: "posted",
      lines,
      releases: [],
      gross: moneyString(f.gross),
      withheld: moneyString(f.withheld),
      released: "0.00",
      invoiceId: null,
      billId: null,
      postedAt: "",
      postedBy: "",
    });
  });
  return done;
}

describe("progress billing (spec D2, ADR 0026)", () => {
  const b1 = [input("L1", "0", "30000"), input("L2", "6000")];
  const b2 = [input("L1", "42000", "0"), input("L2", "24000")];
  const b3 = [input("L1", "72000"), input("L2", "48000"), input("L3", "15000")];

  it("worked example 1: gross and retainage each billing, stored materials do not double", () => {
    const [first, second, third] = post([b1, b2, b3]);
    expect([first!.gross, first!.withheld]).toEqual(["36000.00", "3600.00"]);
    expect([second!.gross, second!.withheld]).toEqual(["30000.00", "3000.00"]);
    expect([third!.gross, third!.withheld]).toEqual(["69000.00", "6900.00"]);
  });

  it("worked example 1: the invariants hold after a change order", () => {
    const billings = post([b1, b2]);
    const lines = [line("L1", "72000"), line("L2", "48000"), line("L3", "15000", { changeOrderId: "co" })];
    const before = contractFigures(contract(), lines.slice(0, 2), billings, []);
    expect(before).toMatchObject({ value: "120000.00", billed: "66000.00", remaining: "54000.00", held: "6600.00" });
    const after = contractFigures(contract(), lines, billings, []);
    expect(after).toMatchObject({ value: "135000.00", billed: "66000.00", remaining: "69000.00" });
    expect(dec(after.billed).plus(after.remaining).toFixed(2)).toBe(after.value);
  });

  it("worked example 2: rounding comes out exact on the last billing", () => {
    const billings = post([
      [input("L1", "12500.00", "0", "5"), input("L2", "5775.00", "0", "5")],
      [input("L1", "27187.50", "0", "5"), input("L2", "12250.00", "0", "5")],
      [input("L1", "31250.00", "0", "5"), input("L2", "17500.00", "0", "5")],
    ]);
    expect(billings.map((b) => b.gross)).toEqual(["18275.00", "21162.50", "9312.50"]);
    expect(billings.map((b) => b.withheld)).toEqual(["913.75", "1058.13", "465.62"]);
    expect(billings.reduce((t, b) => t.plus(b.withheld), dec(0)).toFixed(2)).toBe("2437.50");
  });

  it("worked example 2: a release shares by what each line holds and adds up", () => {
    const billings = post([[input("L1", "31250.00", "0", "5"), input("L2", "17500.00", "0", "5")]]);
    const held = heldByLine(billings, [line("L1", "31250"), line("L2", "17500")]);
    expect(held.get("L1")!.toFixed(2)).toBe("1562.50");
    expect(held.get("L2")!.toFixed(2)).toBe("875.00");
    const parts = allocateRelease("1000.00", held);
    expect(parts.map((p) => p.amount)).toEqual(["641.03", "358.97"]);
  });

  it("refuses billing past a line's value, and a billing that changes nothing", () => {
    const lines = [line("L1", "1000")];
    expect(billingProblem([input("L1", "1200")], lines, [])).toMatch(/value/);
    expect(billingProblem([input("L1", "0")], lines, [])).toMatch(/Nothing/);
    expect(billingProblem([input("L1", "500")], lines, [])).toBeNull();
  });

  it("a deduction can't take a line below what is billed", () => {
    const billings = post([[input("L1", "600")]]);
    const order = (delta: string) =>
      ({ lines: [{ lineId: "L1", description: "", category: "material", amountDelta: delta }] }) as ChangeOrder;
    expect(changeOrderProblem(order("-500"), [line("L1", "1000")], billings)).toMatch(/below/);
    expect(changeOrderProblem(order("-300"), [line("L1", "1000")], billings)).toBeNull();
  });

  it("counts pending change orders separately, and never as value", () => {
    const pending = {
      contractId: "c1",
      status: "pending",
      lines: [{ lineId: null, description: "", category: "material", amountDelta: "500.00" }],
    } as ChangeOrder;
    const figures = contractFigures(contract(), [line("L1", "1000")], [], [pending]);
    expect(figures).toMatchObject({ value: "1000.00", pendingChanges: "500.00" });
  });
});

describe("contract rules (spec D2, ADR 0026)", () => {
  it("a master or unsigned contract past its end is Expired; a running project is not", () => {
    expect(contractDisplayStatus(contract({ kind: "master", endsAt: "2026-01-01" }), "2026-06-01")).toBe("expired");
    expect(contractDisplayStatus(contract({ status: "sent", endsAt: "2026-01-01" }), "2026-06-01")).toBe("expired");
    expect(contractDisplayStatus(contract({ endsAt: "2026-01-01" }), "2026-06-01")).toBe("active");
  });

  it("lines must add up to the value before signing", () => {
    expect(draftProblem(contract(), [line("L1", "100000")])).toMatch(/add up/);
    expect(draftProblem(contract(), [line("L1", "120000")])).toBeNull();
    expect(draftProblem(contract({ kind: "master", originalValue: "0" }), [])).toBeNull();
  });

  it("warns above the state's retainage limit, only where it applies", () => {
    expect(retainageWarning("CA", "10", "50000")).toMatch(/California/);
    expect(retainageWarning("CO", "10", "120000")).toBeNull();
    expect(retainageWarning("CO", "10", "150000")).toMatch(/Colorado/);
    expect(retainageWarning("PA", "10", "900000")).toBeNull();
  });

  it("a contract closes only with nothing held, nothing owed and a final waiver", () => {
    expect(closeProblem({ held: "5.00", balance: "0", hasFinalWaiver: true })).toMatch(/retainage/);
    expect(closeProblem({ held: "0", balance: "5.00", hasFinalWaiver: true })).toMatch(/balance/);
    expect(closeProblem({ held: "0", balance: "0", hasFinalWaiver: false })).toMatch(/waiver/);
    expect(closeProblem({ held: "0", balance: "0", hasFinalWaiver: true })).toBeNull();
  });

  it("insurance status follows the earliest coverage", () => {
    const cert = (dates: string[]) =>
      ({ coverages: dates.map((expiresOn) => ({ expiresOn })) }) as InsuranceCertificate;
    expect(insuranceStatus(cert(["2026-12-31"]), "2026-06-01")).toBe("valid");
    expect(insuranceStatus(cert(["2026-12-31", "2026-06-20"]), "2026-06-01")).toBe("expiring");
    expect(insuranceStatus(cert(["2026-05-01", "2026-12-31"]), "2026-06-01")).toBe("expired");
  });

  it("an unconditional waiver needs a confirmed payment", () => {
    expect(waiverProblem({ type: "unconditional_progress", amount: "100" }, false)).toMatch(/confirmed/);
    expect(waiverProblem({ type: "unconditional_progress", amount: "100" }, true)).toBeNull();
    expect(waiverProblem({ type: "conditional_progress", amount: "100" }, false)).toBeNull();
  });

  it("raises reminders once per notice step", () => {
    const c = contract({ endsAt: "2026-07-01", renewal: { mode: "manual", noticeDays: 30 } });
    const reminders = contractReminders([c], [], [], "2026-05-20");
    expect(reminders).toEqual([
      { key: "c1-end-30", contractId: "c1", what: "Contract end notice is due", date: "2026-06-01" },
    ]);
    const ms = contractReminders([c], [line("M1", "1", { milestoneDueAt: "2026-05-22" })], [], "2026-05-20");
    expect(ms.some((r) => r.key === "M1-ms-3")).toBe(true);
  });

  it("uses the dated 1099 threshold", () => {
    expect(form1099Threshold("2025")).toBe("600");
    expect(form1099Threshold("2026")).toBe("2000");
    expect(form1099Threshold("2030")).toBe("2000");
  });
});
