import { afterEach, describe, expect, it } from "vitest";
import { openLedgerForTests, requireLedger } from "../src/modules/sales/sales-common";

/** Money writes wait for P12's journal entries (CLAUDE.md rule 10; ADR 0038). */
describe("requireLedger", () => {
  const before = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = before;
  });

  it("refuses money writes with 409 ledger_pending whatever the environment says", () => {
    for (const env of ["production", "development", "test"]) {
      process.env.NODE_ENV = env;
      expect(() => requireLedger()).toThrow(expect.objectContaining({ status: 409 }));
    }
  });

  it("opens only when test code asks", () => {
    openLedgerForTests();
    expect(() => requireLedger()).not.toThrow();
  });
});
