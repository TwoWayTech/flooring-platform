import { describe, expect, it } from "vitest";
import { dayIn } from "../src/modules/sales/sales-common";

describe("company days (invoice dates in the company's time zone)", () => {
  it("reads an evening moment in Chicago as that day, not the UTC day after", () => {
    const evening = new Date("2026-11-14T04:15:00Z");
    expect(dayIn(evening, "America/Chicago")).toBe("2026-11-13");
    expect(dayIn(evening, "UTC")).toBe("2026-11-14");
  });

  it("reads a morning moment in Honolulu and in Auckland as their own days", () => {
    const moment = new Date("2026-11-14T09:30:00Z");
    expect(dayIn(moment, "Pacific/Honolulu")).toBe("2026-11-13");
    expect(dayIn(moment, "Pacific/Auckland")).toBe("2026-11-14");
  });
});
