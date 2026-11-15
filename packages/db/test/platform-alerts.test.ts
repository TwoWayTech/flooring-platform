import { describe, expect, it } from "vitest";
import { failureStanding } from "../src/platform-alerts";

/** Where a failed company stands decides the alert's and the migrate script's wording (ADR 0053). */
describe("failureStanding", () => {
  it("says maintenance whenever maintenance mode is on, whatever the database", () => {
    expect(failureStanding({ maintenance: true, readOnly: true })).toBe("maintenance");
    expect(failureStanding({ maintenance: true, readOnly: false })).toBe("maintenance");
  });

  it("says a read-only database out of maintenance still serves reads", () => {
    expect(failureStanding({ maintenance: false, readOnly: true })).toBe("serving_reads");
  });

  it("says a claimed or failed database out of maintenance leaves the company unavailable", () => {
    expect(failureStanding({ maintenance: false, readOnly: false })).toBe("unavailable");
  });
});
