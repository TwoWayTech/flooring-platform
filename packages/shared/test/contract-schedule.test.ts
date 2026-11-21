import { describe, expect, it } from "vitest";
import {
  billingFigures,
  contractSchedule,
  moneyString,
  releaseAllocation,
  scheduleLines,
  sum,
  type BillingLine,
  type ContractBilling,
  type ContractLine,
} from "../src";

const line = (id: string, value: string, contractId = "c1"): ContractLine =>
  ({ id, contractId, code: id, description: id, scheduledValue: value }) as ContractLine;
const input = (lineId: string, completed: string, stored = "0"): BillingLine => ({
  lineId,
  completedToDate: completed,
  storedBalance: stored,
  retainagePct: "5",
  storedRetainagePct: "5",
});

/** Posts progress billings and releases in order, each computed against the ones before. */
function post(steps: (BillingLine[] | { release: { lineId: string; amount: string }[] })[], contractId = "c1") {
  const done: ContractBilling[] = [];
  steps.forEach((step, i) => {
    const base = {
      id: `${contractId}-b${i + 1}`,
      contractId,
      number: i + 1,
      periodEnd: "2026-11-21",
      status: "posted" as const,
      invoiceId: null,
      billId: null,
      postedAt: "",
      postedBy: "",
    };
    if (Array.isArray(step)) {
      const f = billingFigures(step, done);
      done.push({
        ...base,
        kind: "progress",
        lines: step,
        releases: [],
        gross: moneyString(f.gross),
        withheld: moneyString(f.withheld),
        released: "0.00",
      });
    } else {
      const total = moneyString(sum(step.release.map((r) => r.amount)));
      done.push({
        ...base,
        kind: "release",
        lines: [],
        releases: step.release,
        gross: "0.00",
        withheld: "0.00",
        released: total,
      });
    }
  });
  return done;
}

describe("schedule of values per line (contracts.md rule 11a)", () => {
  const lines = [line("L1", "72000.00"), line("L2", "48000.00"), line("M1", "6000.00")];

  it("shows billed to date, retained and remaining for each line", () => {
    const billings = post([
      [input("L1", "30000"), input("L2", "6000")],
      [input("L1", "42000"), input("L2", "24000")],
    ]);
    expect(scheduleLines(lines, billings)).toEqual([
      { lineId: "L1", contractId: "c1", billed: "42000.00", retained: "2100.00", remaining: "30000.00" },
      { lineId: "L2", contractId: "c1", billed: "24000.00", retained: "1200.00", remaining: "24000.00" },
      { lineId: "M1", contractId: "c1", billed: "0.00", retained: "0.00", remaining: "6000.00" },
    ]);
  });

  it("counts stored materials as billed and takes releases off what is retained", () => {
    const billings = post([[input("L1", "10000", "2000")], { release: [{ lineId: "L1", amount: "200.00" }] }]);
    const [l1] = scheduleLines(lines, billings);
    expect(l1).toMatchObject({ billed: "12000.00", retained: "400.00", remaining: "60000.00" });
  });

  it("ignores void billings and billings of other contracts", () => {
    const billings = post([[input("L1", "30000")], [input("L1", "40000")]]);
    billings[1]!.status = "void";
    const other = post([[input("X1", "500")]], "c2");
    const [l1] = scheduleLines(lines, [...billings, ...other]);
    expect(l1).toMatchObject({ billed: "30000.00", retained: "1500.00" });
  });
});

describe("release allocation to billings (contracts.md rule 10a)", () => {
  it("pays a release out of the oldest billing's retainage first", () => {
    const billings = post([
      [input("L1", "30000"), input("L2", "6000")], // withholds 1500 + 300
      [input("L1", "42000"), input("L2", "24000")], // withholds 600 + 900
      {
        release: [
          { lineId: "L1", amount: "1800.00" },
          { lineId: "L2", amount: "600.00" },
        ],
      },
    ]);
    expect(releaseAllocation(billings)).toEqual([
      { billingId: "c1-b1", contractId: "c1", released: "1800.00", covers: [] },
      { billingId: "c1-b2", contractId: "c1", released: "600.00", covers: [] },
      { billingId: "c1-b3", contractId: "c1", released: "2400.00", covers: ["c1-b1", "c1-b2"] },
    ]);
  });

  it("a second release continues where the first stopped", () => {
    const billings = post([
      [input("L1", "10000")], // 500
      [input("L1", "20000")], // 500
      { release: [{ lineId: "L1", amount: "300.00" }] },
      { release: [{ lineId: "L1", amount: "400.00" }] },
    ]);
    const byId = new Map(releaseAllocation(billings).map((r) => [r.billingId, r]));
    expect(byId.get("c1-b1")?.released).toBe("500.00");
    expect(byId.get("c1-b2")?.released).toBe("200.00");
    expect(byId.get("c1-b3")?.covers).toEqual(["c1-b1"]);
    expect(byId.get("c1-b4")?.covers).toEqual(["c1-b1", "c1-b2"]);
  });

  it("a billing that lowers a line gives back its newest withholding first", () => {
    const billings = post([
      [input("L1", "10000")], // 500
      [input("L1", "20000")], // 500
      [input("L1", "16000")], // -200, from billing 2
      { release: [{ lineId: "L1", amount: "800.00" }] },
    ]);
    const byId = new Map(releaseAllocation(billings).map((r) => [r.billingId, r]));
    expect(byId.get("c1-b1")?.released).toBe("500.00");
    expect(byId.get("c1-b2")?.released).toBe("300.00");
    expect(byId.get("c1-b3")?.released).toBe("0.00");
  });

  it("leaves void releases out and keeps contracts apart", () => {
    const billings = post([[input("L1", "10000")], { release: [{ lineId: "L1", amount: "100.00" }] }]);
    billings[1]!.status = "void";
    const schedule = contractSchedule([line("L1", "72000.00")], [...billings, ...post([[input("X1", "1000")]], "c2")]);
    expect(schedule.billings).toEqual([
      { billingId: "c1-b1", contractId: "c1", released: "0.00", covers: [] },
      { billingId: "c2-b1", contractId: "c2", released: "0.00", covers: [] },
    ]);
  });
});
