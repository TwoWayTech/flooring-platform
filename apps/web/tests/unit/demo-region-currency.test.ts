import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENCY_MESSAGES,
  REGION_MESSAGES,
  SETTINGS_SCOPE_MESSAGE,
  type FeatureKey,
  type FeatureRegister,
  type LocalizationSettings,
  type PermissionKey,
  type Role,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value. */
const OFF = vi.hoisted(() => new Set<string>());

vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

afterEach(() => {
  OFF.clear();
});

/** Personas (fixtures): Summit's Owner and Sales rep, Keystone's Owner (a CAD rate) and Harbor's Owner (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const KEYSTONE_OWNER = "ks-usr-01";
const HARBOR_OWNER = "hb-usr-01";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";
const ACTION = "Changed localization and tax";

type Region = LocalizationSettings["region"];
type Currency = LocalizationSettings["currency"];

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with a company open for one person. */
async function open(company: "summit" | "keystone" | "harbor", userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany(company, { userId, viewAsRoleId: null });
  return store;
}

/** Dana viewing Summit as a custom role that holds only `permissions`, at `dataScope`. */
async function viewingAs(permissions: PermissionKey[], dataScope: Role["dataScope"] = "all"): Promise<DemoStore> {
  const store = await open("summit", DANA);
  const sales = (await store.list("roles")).find((role) => role.key === "sales")!;
  const role: Role = {
    ...sales,
    id: `sm-role-${permissions.join("-")}-${dataScope}`,
    key: `custom-${permissions.length}-${dataScope}`,
    name: `Custom ${dataScope}`,
    system: false,
    permissions,
    dataScope,
  };
  await store.saveRole(role);
  store.setViewer({ userId: DANA, viewAsRoleId: role.id });
  return store;
}

/** A store's region with a change; a refused value is read as the stored type, as a screen could send it. */
async function regionOf(store: DemoStore, patch: Partial<Record<keyof Region, unknown>>): Promise<Region> {
  return { ...(await store.getSettings()).localization.region, ...patch } as Region;
}

/** A store's currency with its first extra rate replaced. */
async function rateOf(store: DemoStore, rate: string): Promise<Currency> {
  const currency = (await store.getSettings()).localization.currency;
  return { ...currency, extra: currency.extra.map((entry, i) => (i === 0 ? { ...entry, rate } : entry)) };
}

/** The audit entries a save added. */
async function addedBy(store: DemoStore, save: () => Promise<unknown>) {
  const seen = new Set((await store.list("audit")).map((row) => row.id));
  await save();
  return (await store.list("audit")).filter((row) => !seen.has(row.id));
}

describe("DemoStore saves Region and Currency with the API's rules (ADR 0059, part 2b)", () => {
  it("RD1 a time zone change is refused against the company's own copy, and nothing is stored or audited", async () => {
    const store = await open("summit", DANA);
    const before = await store.getSettings();
    const audits = (await store.list("audit")).length;
    await expect(
      store.updateLocalization("region", await regionOf(store, { timeZone: "America/Chicago" })),
    ).rejects.toThrow(REGION_MESSAGES.timeZone);
    expect(await store.getSettings()).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("RD2 Region's content rules, each with its words", async () => {
    const store = await open("summit", DANA);
    const before = (await store.getSettings()).localization.region;
    const cases: [Partial<Record<keyof Region, unknown>>, string][] = [
      [{ dateFormat: "dd/MM/yyyy" }, REGION_MESSAGES.dateFormat],
      [{ fiscalYearStartMonth: 13 }, REGION_MESSAGES.fiscalYearStartMonth],
      [{ statesOfOperation: [] }, REGION_MESSAGES.statesOfOperation],
      [{ statesOfOperation: ["CO", "CO"] }, REGION_MESSAGES.statesOfOperation],
      [{ primaryState: "XX" }, REGION_MESSAGES.primaryState],
      [{ locale: "en-CA" }, REGION_MESSAGES.countryLocale("US", "en-US")],
    ];
    for (const [patch, message] of cases)
      await expect(store.updateLocalization("region", await regionOf(store, patch)), message).rejects.toThrow(message);
    expect((await store.getSettings()).localization.region).toEqual(before);
  });

  it("RD3 the Owner changes the states of operation: saved, audited naming Region", async () => {
    const store = await open("summit", DANA);
    const added = await addedBy(store, async () =>
      store.updateLocalization("region", await regionOf(store, { statesOfOperation: ["CO"] })),
    );
    expect((await store.getSettings()).localization.region.statesOfOperation).toEqual(["CO"]);
    expect(added.map((row) => [row.action, row.target])).toEqual([[ACTION, "Region"]]);
  });

  it("RD4 without the sales tax key a states change is refused; another Region change saves", async () => {
    const store = await viewingAs(["settings.localization.manage"]);
    const before = await store.getSettings();
    const audits = (await store.list("audit")).length;
    await expect(
      store.updateLocalization("region", await regionOf(store, { statesOfOperation: ["CO"] })),
    ).rejects.toThrow(REGION_MESSAGES.statesNeedTax);
    expect(await store.getSettings()).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
    await store.updateLocalization("region", await regionOf(store, { dateFormat: "yyyy-MM-dd" }));
    expect((await store.getSettings()).localization.region.dateFormat).toBe("yyyy-MM-dd");
  });

  it("RD5 a changed rate is dated today; the same value keeps its stored entry", async () => {
    const store = await open("keystone", KEYSTONE_OWNER);
    const seeded = (await store.getSettings()).localization.currency.extra[0]!;
    expect([seeded.code, seeded.rate]).toEqual(["CAD", "1.3870"]);
    // A sent `asOf` is never stored: the save dates the changed rate itself.
    const raised = await rateOf(store, "1.3900");
    await store.updateLocalization("currency", {
      ...raised,
      extra: raised.extra.map((entry) => ({ ...entry, asOf: "1999-01-01" })),
    });
    const changed = (await store.getSettings()).localization.currency.extra[0]!;
    expect(changed).toEqual({ code: "CAD", rate: "1.3900", asOf: store.today() });
    const sent = await rateOf(store, "1.39");
    await store.updateLocalization("currency", {
      ...sent,
      extra: sent.extra.map((entry) => ({ ...entry, asOf: "1999-01-01" })),
    });
    expect((await store.getSettings()).localization.currency.extra[0]).toEqual(changed);
  });

  it("RD6 Currency keeps its base, lock and codes, and takes plain rates above 0", async () => {
    const store = await open("keystone", KEYSTONE_OWNER);
    const currency = (await store.getSettings()).localization.currency;
    const entry = currency.extra[0]!;
    const cases: [unknown, string][] = [
      [{ ...currency, base: "CAD" }, CURRENCY_MESSAGES.base("USD")],
      [{ ...currency, locked: false }, CURRENCY_MESSAGES.base("USD")],
      [{ ...currency, extra: [entry, { ...entry, code: "EUR" }] }, CURRENCY_MESSAGES.codes],
      [{ ...currency, extra: [] }, CURRENCY_MESSAGES.codes],
      [{ ...currency, extra: [{ ...entry, code: "CAN" }] }, CURRENCY_MESSAGES.codes],
      [await rateOf(store, "0"), CURRENCY_MESSAGES.rate("CAD")],
      [await rateOf(store, "1."), CURRENCY_MESSAGES.rate("CAD")],
    ];
    for (const [value, message] of cases)
      await expect(store.updateLocalization("currency", value as Currency), message).rejects.toThrow(message);
    expect((await store.getSettings()).localization.currency).toEqual(currency);
  });

  it("RD7 the HR Suite's Owner saves Region: every company has it", async () => {
    const store = await open("harbor", HARBOR_OWNER);
    await store.updateLocalization("region", await regionOf(store, { dateFormat: "yyyy-MM-dd" }));
    expect((await store.getSettings()).localization.region.dateFormat).toBe("yyyy-MM-dd");
  });

  it("RD8 the page's switch off: the switch's words for the Owner, the role's for Sales", async () => {
    OFF.add("settings.localization");
    const dana = await open("summit", DANA);
    const { region, currency } = (await dana.getSettings()).localization;
    await expect(dana.updateLocalization("region", region)).rejects.toThrow("This feature is switched off.");
    await expect(dana.updateLocalization("currency", currency)).rejects.toThrow("This feature is switched off.");
    const priya = await open("summit", PRIYA);
    await expect(priya.updateLocalization("region", region)).rejects.toThrow(ROLE_REFUSAL);
  });

  it("RD9 a role below company-wide scope saves neither tab", async () => {
    const store = await viewingAs(["settings.localization.manage"], "branch");
    const { region, currency } = (await store.getSettings()).localization;
    await expect(store.updateLocalization("region", region)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
    await expect(store.updateLocalization("currency", currency)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
  });

  it("RD10 the whole-section path refuses a zone change too", async () => {
    const store = await open("summit", DANA);
    const whole = (await store.getSettings()).localization;
    await expect(
      store.updateSettings("localization", { ...whole, region: { ...whole.region, timeZone: "Europe/Paris" } }),
    ).rejects.toThrow(REGION_MESSAGES.timeZone);
  });
});
