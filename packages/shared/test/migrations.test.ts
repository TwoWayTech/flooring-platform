import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADDED_IN_V2,
  ALL_PERMISSION_KEYS,
  OVERLAY_SCHEMA_VERSION,
  OverlayUpgradeError,
  mergeDefaults,
  permissionDef,
  upgradeCeiling,
  upgradeCompany,
  upgradeOverlay,
  type CompanyFixtures,
  type PlatformFixtures,
  type Role,
} from "../src";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const summit = JSON.parse(readFileSync(`${FIXTURES}summit.json`, "utf8")) as CompanyFixtures;
const platform = JSON.parse(readFileSync(`${FIXTURES}platform.json`, "utf8")) as PlatformFixtures;
const shift = { days: 0, weeks: 0 };
const role = (key: string) => summit.roles.find((r) => r.key === key)!;

describe("saved demo data upgrade (plan section 2.3)", () => {
  it("lists only keys that exist in the catalog", () => {
    for (const key of ADDED_IN_V2) expect(permissionDef(key), key).toBeDefined();
  });

  it("renames retired keys in a custom role and adds nothing", () => {
    const custom: Role = {
      ...role("sales"),
      id: "sm-role-custom",
      system: false,
      permissions: ["sales.quote.view", "sales.payment.create"] as Role["permissions"],
    };
    const out = upgradeOverlay(
      { shift, settings: null, records: { roles: { [custom.id]: custom } } },
      { base: summit },
    );
    expect((out.records.roles![custom.id] as Role).permissions).toEqual(["sales.quote.view", "sales.payment.record"]);
    expect(out.schemaVersion).toBe(OVERLAY_SCHEMA_VERSION);
  });

  it("drops payment recording from a saved Sales role, as the new default does", () => {
    const saved = {
      ...role("sales"),
      permissions: ["sales.quote.view", "sales.payment.create"] as Role["permissions"],
    };
    const out = upgradeOverlay({ shift, settings: null, records: { roles: { [saved.id]: saved } } }, { base: summit });
    const permissions = (out.records.roles![saved.id] as Role).permissions;
    expect(permissions).not.toContain("sales.payment.record");
    expect(permissions).toContain("sales.commission.view");
  });

  it("gives a saved Owner role every key of the fresh Owner role", () => {
    const saved = { ...role("owner"), permissions: ["dashboard.overview.view"] as Role["permissions"] };
    const out = upgradeOverlay({ shift, settings: null, records: { roles: { [saved.id]: saved } } }, { base: summit });
    expect((out.records.roles![saved.id] as Role).permissions).toEqual(role("owner").permissions);
  });

  it("fills saved settings with sections and fields added since", () => {
    const saved = { branding: { ...summit.settings.branding, displayName: "Changed" } };
    const merged = mergeDefaults(summit.settings, saved);
    expect(merged.branding.displayName).toBe("Changed");
    expect(merged.localization).toEqual(summit.settings.localization);
  });

  it("adds the new keys of the company's modules to a saved ceiling", () => {
    const company = platform.companies.find((c) => c.id === "summit")!;
    const old = { ...company, ceiling: company.ceiling.filter((k) => !ADDED_IN_V2.includes(k)) };
    const upgraded = upgradeCompany({ ...old, ceiling: [...old.ceiling, "purchasing.bill.pay" as never] });
    expect(upgraded.ceiling).toContain("purchasing.payment.record");
    expect(upgraded.ceiling).toContain("sales.payment.approve");
    expect(upgraded.ceiling.every((k) => ALL_PERMISSION_KEYS.includes(k))).toBe(true);
    expect(upgradeCeiling(["hr.overview.view"], ["platform", "hr"])).not.toContain("sales.payment.record");
  });

  it("refuses data from an unknown future version", () => {
    expect(() => upgradeOverlay({ schemaVersion: 9, shift, settings: null, records: {} }, { base: summit })).toThrow(
      OverlayUpgradeError,
    );
  });
});
