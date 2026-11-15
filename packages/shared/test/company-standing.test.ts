import { describe, expect, it } from "vitest";
import {
  blocksCompany,
  COMPANY_STANDING_STATES,
  companyStandingFromWire,
  companyStandingState,
  isCompanyStandingState,
  STANDING_SCREENS,
} from "../src/platform/company-standing";
import type { CompanyStandingState } from "../src/types/platform";

describe("companyStandingState (platform-admin spec part 4, GET /company/standing)", () => {
  const flags = [false, true] as const;

  it("follows TenantGuard's order over all 16 combinations: maintenance, unavailable, locked, read only, full", () => {
    const seen = new Set<CompanyStandingState>();
    for (const maintenanceMode of flags)
      for (const databaseUsable of flags)
        for (const readOnly of flags)
          for (const locked of flags) {
            const state = companyStandingState({
              maintenanceMode,
              databaseUsable,
              readOnly,
              phase: locked ? "locked" : readOnly ? "read_only" : "full",
            });
            const expected: CompanyStandingState = maintenanceMode
              ? "maintenance"
              : !databaseUsable
                ? "unavailable"
                : locked
                  ? "locked"
                  : readOnly
                    ? "read_only"
                    : "full";
            expect(state, JSON.stringify({ maintenanceMode, databaseUsable, readOnly, locked })).toBe(expected);
            seen.add(state);
          }
    expect([...seen].sort()).toEqual([...COMPANY_STANDING_STATES].sort());
  });

  it("is read only for a read-only database while the phase is full", () => {
    expect(companyStandingState({ maintenanceMode: false, databaseUsable: true, readOnly: true, phase: "full" })).toBe(
      "read_only",
    );
  });
});

describe("blocksCompany", () => {
  it("blocks for maintenance, an unavailable database and a locked company only", () => {
    const blocked = COMPANY_STANDING_STATES.filter((state) => blocksCompany(state));
    expect([...blocked].sort()).toEqual(["locked", "maintenance", "unavailable"]);
    expect(blocksCompany("full")).toBe(false);
    expect(blocksCompany("read_only")).toBe(false);
  });
});

describe("companyStandingFromWire (deny by default)", () => {
  it("reads each of the five states", () => {
    for (const state of COMPANY_STANDING_STATES) expect(companyStandingFromWire({ state })).toEqual({ state });
    expect(COMPANY_STANDING_STATES).toHaveLength(5);
  });

  it("reads anything else as unavailable", () => {
    for (const body of ["weird", null, {}, 7, { state: "weird" }, { state: null }, { state: 7 }, undefined, []]) {
      expect(companyStandingFromWire(body), JSON.stringify(body)).toEqual({ state: "unavailable" });
    }
  });

  it("drops every other field", () => {
    const standing = companyStandingFromWire({ state: "read_only", reason: "suspended", lockedFrom: "2026-12-01" });
    expect(standing).toEqual({ state: "read_only" });
    expect(Object.keys(standing)).toEqual(["state"]);
  });

  it("knows only the five states", () => {
    expect(isCompanyStandingState("full")).toBe(true);
    expect(isCompanyStandingState("FULL")).toBe(false);
    expect(isCompanyStandingState(undefined)).toBe(false);
  });
});

describe("STANDING_SCREENS", () => {
  it("has a title and a text for each blocking state, with no billing words or dates", () => {
    expect(Object.keys(STANDING_SCREENS).sort()).toEqual(["locked", "maintenance", "unavailable"]);
    for (const screen of Object.values(STANDING_SCREENS)) {
      expect(screen.title.length).toBeGreaterThan(0);
      expect(screen.body.length).toBeGreaterThan(0);
      expect(screen.body).not.toMatch(/pay|plan|bill|trial|\d/i);
    }
  });
});
