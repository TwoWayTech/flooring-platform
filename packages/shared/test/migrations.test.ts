import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADDED_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  OVERLAY_SCHEMA_VERSION,
  OverlayUpgradeError,
  overlayFileIds,
  permissionDef,
  upgradeCeiling,
  upgradeCompany,
  upgradeOverlay,
  type PlatformFixtures,
} from "../src";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const platform = JSON.parse(readFileSync(`${FIXTURES}platform.json`, "utf8")) as PlatformFixtures;
const shift = { days: 0, weeks: 0, months: 0 };

describe("saved demo data (feature batch 3 plan, section 5)", () => {
  it("keeps an overlay of the current version", () => {
    const stored = { schemaVersion: OVERLAY_SCHEMA_VERSION, shift, settings: null, records: {} };
    expect(upgradeOverlay(stored)).toBe(stored);
  });

  it("refuses an overlay from an older version, so the company starts fresh", () => {
    expect(() => upgradeOverlay({ schemaVersion: 3, shift, settings: null, records: {} })).toThrow(OverlayUpgradeError);
    expect(() => upgradeOverlay({ shift, settings: null, records: {} })).toThrow(OverlayUpgradeError);
  });

  it("upgrades version 4's quantities sent as numbers to decimal strings, and keeps everything else (F-k)", () => {
    const records = {
      products: { p1: { id: "p1", reorderPoint: 692.85, widthFt: 12, price: "4.50" }, p2: null },
      rolls: { r1: { id: "r1", widthFt: 15, remainingLengthFt: "40.5", cuts: [{ lengthFt: "10" }] } },
      quotes: { q1: { id: "q1", rooms: [{ id: "a", x: 1.5, y: 0, widthFt: 12.5, lengthFt: 9 }] } },
      importBatches: { b1: { changes: [{ before: { widthFt: 12 }, after: { widthFt: 15 } }] } },
    };
    const upgraded = upgradeOverlay({ schemaVersion: 4, shift, settings: { a: 1 }, records });
    expect(OVERLAY_SCHEMA_VERSION).toBe(5);
    expect(upgraded).toEqual({
      schemaVersion: 5,
      shift,
      settings: { a: 1 },
      records: {
        products: { p1: { id: "p1", reorderPoint: "692.85", widthFt: "12", price: "4.50" }, p2: null },
        rolls: { r1: { id: "r1", widthFt: "15", remainingLengthFt: "40.5", cuts: [{ lengthFt: "10" }] } },
        quotes: { q1: { id: "q1", rooms: [{ id: "a", x: 1.5, y: 0, widthFt: "12.5", lengthFt: "9" }] } },
        importBatches: { b1: { changes: [{ before: { widthFt: "12" }, after: { widthFt: "15" } }] } },
      },
    });
  });

  it("refuses data from an unknown future version", () => {
    expect(() => upgradeOverlay({ schemaVersion: 9, shift, settings: null, records: {} })).toThrow(OverlayUpgradeError);
  });

  it("finds the uploaded files of a dropped overlay", () => {
    const records = {
      payments: { p1: { id: "p1", files: [{ id: "file-a" }, { id: "file-b" }] }, p2: null },
      bills: { b1: { id: "b1", files: [{ id: "file-c" }] } },
      quotes: { q1: { id: "q1" } },
    };
    expect(overlayFileIds({ schemaVersion: 3, shift, settings: null, records })).toEqual([
      "file-a",
      "file-b",
      "file-c",
    ]);
  });
});

describe("a company saved by the super-admin in an older demo", () => {
  const company = platform.companies.find((c) => c.id === "summit")!;

  it("lists only keys that exist in the catalog", () => {
    for (const key of ADDED_PERMISSIONS) expect(permissionDef(key), key).toBeDefined();
  });

  it("gains the new keys and modules of its plan", () => {
    const old = {
      ...company,
      modules: company.modules.filter((m) => m !== "contracts"),
      ceiling: company.ceiling.filter((k) => !ADDED_PERMISSIONS.includes(k)),
    };
    const upgraded = upgradeCompany({ ...old, ceiling: [...old.ceiling, "purchasing.bill.pay" as never] }, company);
    expect(upgraded.ceiling).toContain("purchasing.payment.record");
    expect(upgraded.ceiling).toContain("contracts.contract.view");
    expect(upgraded.modules).toContain("contracts");
    expect(upgraded.ceiling.every((k) => ALL_PERMISSION_KEYS.includes(k))).toBe(true);
    expect(upgradeCeiling(["hr.overview.view"], ["platform", "hr"])).not.toContain("sales.payment.record");
  });
});
