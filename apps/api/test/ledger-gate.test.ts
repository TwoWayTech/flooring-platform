import { afterEach, describe, expect, it } from "vitest";
import { requireLedger } from "../src/modules/sales/sales-common";

/** Money writes wait for P12's journal entries (CLAUDE.md rule 10; ADR 0038). */
describe("requireLedger", () => {
  const before = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = before;
  });

  it("refuses money writes outside the tests with 409 ledger_pending", () => {
    for (const env of ["production", "development"]) {
      process.env.NODE_ENV = env;
      expect(() => requireLedger()).toThrow(expect.objectContaining({ status: 409 }));
    }
  });

  it("lets the integration tests run the rules", () => {
    process.env.NODE_ENV = "test";
    expect(() => requireLedger()).not.toThrow();
  });
});
