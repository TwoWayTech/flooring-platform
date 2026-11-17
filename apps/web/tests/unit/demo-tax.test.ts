import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_SCOPE_MESSAGE,
  TAX_MESSAGES,
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

/** Personas (fixtures): Summit's Owner and Sales rep, Harbor's Owner (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_OWNER = "hb-usr-01";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";
const ACTION = "Changed localization and tax";
/** Summit's accepted Colorado quotes with no invoice yet (fixtures): one converted before a change, one after. */
const BEFORE_QUOTE = "sm-quo-0289";
const AFTER_QUOTE = "sm-quo-0291";

type Tax = LocalizationSettings["tax"];

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with a company open for one person. */
async function open(company: "summit" | "harbor", userId: string): Promise<DemoStore> {
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

/** A store's Sales tax tab. */
async function taxOf(store: DemoStore): Promise<Tax> {
  return (await store.getSettings()).localization.tax;
}

/** A tab with one state's rule changed; a refused value is read as the stored type, as a screen could send it. */
function withRule(tax: Tax, state: string, patch: Record<string, unknown>): Tax {
  return { ...tax, rules: tax.rules.map((rule) => (rule.state === state ? { ...rule, ...patch } : rule)) } as Tax;
}

/** A tab with one county rate (by id) changed. */
function withCounty(tax: Tax, id: string, patch: Record<string, unknown>): Tax {
  return {
    ...tax,
    jurisdictions: tax.jurisdictions.map((rate) => (rate.id === id ? { ...rate, ...patch } : rate)),
  } as Tax;
}

/** The audit entries a save added. */
async function addedBy(store: DemoStore, save: () => Promise<unknown>) {
  const seen = new Set((await store.list("audit")).map((row) => row.id));
  await save();
  return (await store.list("audit")).filter((row) => !seen.has(row.id));
}

describe("DemoStore saves Sales tax with the API's rules and versions (ADR 0059, part 3a)", () => {
  it("TD1 a changed rate is the next version from today; the rest stays; one audit entry naming Sales tax", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    const added = await addedBy(store, () =>
      store.updateLocalization("tax", withRule(before, "CO", { ratePct: "8.5" })),
    );
    const after = await taxOf(store);
    const co = after.rules.filter((rule) => rule.state === "CO");
    expect(co).toHaveLength(1);
    expect(co[0]).toMatchObject({ ratePct: "8.5", version: 2, validFrom: store.today(), validTo: null });
    expect(after.rules.find((rule) => rule.state === "PA")).toEqual(before.rules.find((rule) => rule.state === "PA"));
    expect(after.rules.map((rule) => rule.state)).toEqual(["CO", "FL", "MD", "NJ", "PA", "TX"]);
    expect(added.map((row) => [row.action, row.target])).toEqual([[ACTION, "Sales tax"]]);
  });

  it("TD2 each refusal with the API's words, in its order; nothing stored or audited", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    const audits = (await store.list("audit")).length;
    const elPaso = before.jurisdictions.find((rate) => rate.id === "jur-co-el-paso")!;
    const cases: [Tax, string][] = [
      [{ ...before, pricesInclude: "inclusive" }, TAX_MESSAGES.pricesInclude],
      [withRule(before, "CO", { ratePct: "8.123456" }), TAX_MESSAGES.rulePercent("CO")],
      [{ ...before, rules: [...before.rules, before.rules[0]!] }, TAX_MESSAGES.stateOnce(before.rules[0]!.state)],
      [
        {
          ...before,
          jurisdictions: [...before.jurisdictions, { ...elPaso, id: "jur-twice", county: "el paso county" }],
        },
        TAX_MESSAGES.sameCounty("el paso county", "CO"),
      ],
      [{ ...before, filing: [] }, TAX_MESSAGES.notHere],
      // Content order: prices before a bad rate.
      [{ ...withRule(before, "CO", { ratePct: "8.123456" }), pricesInclude: "inclusive" }, TAX_MESSAGES.pricesInclude],
    ];
    for (const [value, message] of cases)
      await expect(store.updateLocalization("tax", value), message).rejects.toThrow(message);
    expect(await taxOf(store)).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("TD3 a rate resent at the columns' scale is unchanged: version and start kept", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    await store.updateLocalization("tax", withRule(before, "CO", { ratePct: "8.81000000" }));
    const after = await taxOf(store);
    for (const rule of before.rules)
      expect(
        after.rules.find((r) => r.state === rule.state),
        rule.state,
      ).toEqual(rule);
    expect(after.rules).toHaveLength(before.rules.length);
  });

  it("TD4 county rates: a changed one keeps its id from today, a new one keeps its id, a removed one goes", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    const elPaso = before.jurisdictions.find((rate) => rate.id === "jur-co-el-paso")!;
    const adams = { ...elPaso, id: "jur-tmp", county: "Adams", name: "Adams County combined", ratePct: "7" };
    await store.updateLocalization("tax", {
      ...withCounty(before, "jur-co-el-paso", { ratePct: "8" }),
      jurisdictions: [
        { ...elPaso, ratePct: "8" },
        before.jurisdictions.find((rate) => rate.id === "jur-pa-philadelphia")!,
        adams,
      ],
    });
    const after = await taxOf(store);
    const today = store.today();
    expect(after.jurisdictions.map((rate) => [rate.id, rate.ratePct, rate.validFrom === today])).toEqual([
      ["jur-tmp", "7", true],
      ["jur-co-el-paso", "8", true],
      ["jur-pa-philadelphia", "8", false],
    ]);
  });

  it("TD5 the company default is dated today when it changes", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    await store.updateLocalization("tax", { ...before, companyDefault: { ...before.companyDefault!, ratePct: "5" } });
    expect((await taxOf(store)).companyDefault).toEqual({
      ...before.companyDefault!,
      ratePct: "5",
      validFrom: store.today(),
    });
    await store.updateLocalization("tax", { ...(await taxOf(store)), companyDefault: before.companyDefault });
    expect((await taxOf(store)).companyDefault).toEqual({ ...before.companyDefault!, validFrom: store.today() });
  });

  it("TD6 keys, scope and switch in the API's order; the HR Suite's Owner saves Sales tax (platform)", async () => {
    const localOnly = await viewingAs(["settings.localization.manage"]);
    await expect(localOnly.updateLocalization("tax", await taxOf(localOnly))).rejects.toThrow(ROLE_REFUSAL);
    const branch = await viewingAs(["settings.tax.manage"], "branch");
    await expect(branch.updateLocalization("tax", await taxOf(branch))).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
    OFF.add("settings.localization");
    const dana = await open("summit", DANA);
    await expect(dana.updateLocalization("tax", await taxOf(dana))).rejects.toThrow("This feature is switched off.");
    const priya = await open("summit", PRIYA);
    await expect(priya.updateLocalization("tax", await taxOf(priya))).rejects.toThrow(ROLE_REFUSAL);
    OFF.clear();
    const harbor = await open("harbor", HARBOR_OWNER);
    const theirs = await taxOf(harbor);
    await harbor.updateLocalization("tax", { ...theirs, rounding: theirs.rounding === "line" ? "invoice" : "line" });
    expect((await taxOf(harbor)).rounding).not.toBe(theirs.rounding);
  });

  it("TD7 an issued invoice keeps its tax; a quote converted after the change takes the new version and total", async () => {
    const store = await open("summit", DANA);
    const issued = await store.convertQuoteToInvoice(BEFORE_QUOTE);
    expect(issued.taxRule).toMatchObject({ state: "CO", version: 1 });
    const before = await taxOf(store);
    await store.updateLocalization("tax", withRule(before, "CO", { ratePct: "8.5" }));
    const kept = (await store.list("invoices")).find((invoice) => invoice.id === issued.id)!;
    expect([kept.tax, kept.total, kept.taxRule]).toEqual([issued.tax, issued.total, issued.taxRule]);
    const late = await store.convertQuoteToInvoice(AFTER_QUOTE);
    expect(late.taxRule).toMatchObject({ state: "CO", ratePct: "8.5", version: 2 });
    const quote = (await store.list("quotes")).find((each) => each.id === AFTER_QUOTE)!;
    expect(quote.total).toBe(late.total);
  });

  it("TD9 saved data with tax-inclusive prices can go back to before tax; never the other way", async () => {
    const store = await open("summit", DANA);
    const whole = (await store.getSettings()).localization;
    await store.updateSettings("localization", { ...whole, tax: { ...whole.tax, pricesInclude: "inclusive" } });
    expect((await taxOf(store)).pricesInclude).toBe("inclusive");
    await store.updateLocalization("tax", { ...(await taxOf(store)), pricesInclude: "exclusive" });
    expect((await taxOf(store)).pricesInclude).toBe("exclusive");
    await expect(
      store.updateLocalization("tax", { ...(await taxOf(store)), pricesInclude: "inclusive" }),
    ).rejects.toThrow(TAX_MESSAGES.pricesInclude);
  });

  it("TD10 a county rate resent with another id changes nothing: identity is the county", async () => {
    const store = await open("summit", DANA);
    const before = await taxOf(store);
    await store.updateLocalization("tax", withCounty(before, "jur-co-el-paso", { id: "jur-abcdef12" }));
    const after = await taxOf(store);
    expect(after.jurisdictions.map((rate) => rate.id)).toContain("jur-co-el-paso");
    expect(after.jurisdictions.map((rate) => rate.id)).not.toContain("jur-abcdef12");
    expect(after.jurisdictions.find((rate) => rate.id === "jur-co-el-paso")).toEqual(
      before.jurisdictions.find((rate) => rate.id === "jur-co-el-paso"),
    );
  });
});
