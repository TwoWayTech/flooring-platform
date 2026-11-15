import { describe, expect, it } from "vitest";
import { shownAnswer, type KeyedAnswer } from "@/features/reports/report-answer";

const OCTOBER = JSON.stringify({ from: "2026-10-01", to: "2026-10-31" });
const NOVEMBER = JSON.stringify({ from: "2026-11-01", to: "2026-11-04" });

/** An answer read for October's filters. */
const october: KeyedAnswer<string> = { reportKey: "business", request: OCTOBER, report: "October figures" };

describe("shownAnswer (ADR 0055: an export always matches its filters)", () => {
  it("shows nothing before the first answer, so the skeleton or error shows and exports stay off", () => {
    expect(shownAnswer<string>(undefined, "business", OCTOBER)).toEqual({ report: null, busy: false });
  });

  it("shows the answer and lets exports run when it was read for the current filters", () => {
    expect(shownAnswer(october, "business", OCTOBER)).toEqual({ report: "October figures", busy: false });
  });

  it("keeps the last rows but marks them busy once the filters change, so exports wait", () => {
    expect(shownAnswer(october, "business", NOVEMBER)).toEqual({ report: "October figures", busy: true });
  });

  it("never shows another report's rows", () => {
    const pnl: KeyedAnswer<string> = { reportKey: "pnl", request: OCTOBER, report: "P&L rows" };
    expect(shownAnswer(pnl, "sales", OCTOBER)).toEqual({ report: null, busy: false });
  });
});
