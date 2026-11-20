import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREDIT_NOTE_PREFIX,
  DOCUMENT_MESSAGES,
  overtimeRuleProblem,
  PAYROLL_MESSAGES,
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

/** Summit personas (fixtures): the Owner and a Sales rep; Harbor's Owner (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_OWNER = "hb-usr-01";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";
const MODULE_REFUSAL = "This part of the product is not switched on for your company.";
const SECTION_REFUSAL = "Localization and tax saves one tab at a time.";

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

/** The first person of a company who holds the default role `key`. */
async function holderOf(company: "summit" | "harbor", ownerId: string, key: string): Promise<string> {
  const owner = await open(company, ownerId);
  const role = (await owner.list("roles")).find((candidate) => candidate.key === key)!;
  return (await owner.list("users")).find((user) => user.roleIds.includes(role.id))!.id;
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

/** A store's documents with a change. */
async function documentsOf(store: DemoStore, patch: Partial<Record<string, unknown>>) {
  return { ...(await store.getSettings()).localization.documents, ...patch } as LocalizationSettings["documents"];
}

describe("DemoStore saves Localization one tab at a time, with the API's rules (ADR 0059, part 2a)", () => {
  it("LD1 a refused late fee is not stored and writes no audit entry", async () => {
    const store = await open("summit", DANA);
    const before = (await store.getSettings()).localization;
    const audits = (await store.list("audit")).length;
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { lateFeePct: "12." })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.lateFeePct);
    expect((await store.getSettings()).localization).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("LD2 the default deposit is a percent up to 100", async () => {
    const store = await open("summit", DANA);
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { defaultDepositPct: "100.5" })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.defaultDepositPct);
    await store.updateLocalization("documents", await documentsOf(store, { defaultDepositPct: "100" }));
    expect((await store.getSettings()).localization.documents.defaultDepositPct).toBe("100");
  });

  it("LD3 the default waste must cover every category", async () => {
    const store = await open("summit", DANA);
    const waste: Record<string, string> = { ...(await store.getSettings()).localization.documents.defaultWastePct };
    delete waste.carpet;
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { defaultWastePct: waste })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.wasteCategories);
  });

  it("LD4 prefixes and the legal footer", async () => {
    const store = await open("summit", DANA);
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { quotePrefix: "Q 1" })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.quotePrefix);
    const { invoicePrefix } = (await store.getSettings()).localization.documents;
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { quotePrefix: invoicePrefix })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.samePrefix);
    // Review round 1: credit notes are numbered CR- among the invoices, in any case.
    for (const prefix of [CREDIT_NOTE_PREFIX, "cr-"])
      await expect(
        store.updateLocalization("documents", await documentsOf(store, { invoicePrefix: prefix })),
        prefix,
      ).rejects.toThrow(DOCUMENT_MESSAGES.creditNotePrefix);
    expect((await store.getSettings()).localization.documents.invoicePrefix).toBe(invoicePrefix);
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { legalFooter: "x".repeat(1001) })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.legalFooter);
  });

  it("LD5 days are whole and in range", async () => {
    const store = await open("summit", DANA);
    for (const quoteExpiryDays of [0, 2.5])
      await expect(
        store.updateLocalization("documents", await documentsOf(store, { quoteExpiryDays })),
        String(quoteExpiryDays),
      ).rejects.toThrow(DOCUMENT_MESSAGES.quoteExpiryDays);
    await expect(
      store.updateLocalization("documents", await documentsOf(store, { balanceDueDays: -1 })),
    ).rejects.toThrow(DOCUMENT_MESSAGES.balanceDueDays);
    await store.updateLocalization("documents", await documentsOf(store, { balanceDueDays: 0 }));
    expect((await store.getSettings()).localization.documents.balanceDueDays).toBe(0);
  });

  it("LD6 settings.tax.manage saves only Sales tax: the section's any-of is closed for every tab", async () => {
    const store = await viewingAs(["settings.tax.manage"]);
    const { documents, tax } = (await store.getSettings()).localization;
    await expect(store.updateLocalization("documents", documents)).rejects.toThrow(ROLE_REFUSAL);
    await store.updateLocalization("tax", tax);
  });

  it("LD7 settings.localization.manage can't save Sales tax", async () => {
    const store = await viewingAs(["settings.localization.manage"]);
    const { tax } = (await store.getSettings()).localization;
    await expect(store.updateLocalization("tax", tax)).rejects.toThrow(ROLE_REFUSAL);
  });

  it("LD8 an HR Suite company has no core module: no Sales and documents, but its Payroll rules save", async () => {
    const store = await open("harbor", HARBOR_OWNER);
    const { documents } = (await store.getSettings()).localization;
    await expect(store.updateLocalization("documents", documents)).rejects.toThrow(MODULE_REFUSAL);
    await store.updateLocalization("payroll", { overtimeRule: "federal", holidayState: "FL" });
    expect((await store.getSettings()).localization.payroll).toEqual({ overtimeRule: "federal", holidayState: "FL" });
  });

  it("LD8b the module is checked before the keys, as on the API: Harbor's Employee gets the module's words", async () => {
    const employee = await open("harbor", await holderOf("harbor", HARBOR_OWNER, "employee"));
    const { documents } = (await employee.getSettings()).localization;
    await expect(employee.updateLocalization("documents", documents)).rejects.toThrow(MODULE_REFUSAL);
  });

  it("LD9 the page's switch off: refused with the switch's words, after the keys", async () => {
    OFF.add("settings.localization");
    const dana = await open("summit", DANA);
    const { documents } = (await dana.getSettings()).localization;
    await expect(dana.updateLocalization("documents", documents)).rejects.toThrow("This feature is switched off.");
    const priya = await open("summit", PRIYA);
    await expect(priya.updateLocalization("documents", documents)).rejects.toThrow(ROLE_REFUSAL);
  });

  it("LD10 a role below company-wide scope can't save a tab", async () => {
    const store = await viewingAs(["settings.localization.manage"], "branch");
    const { payroll } = (await store.getSettings()).localization;
    await expect(store.updateLocalization("payroll", payroll)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
  });

  it("LD11 the Accountant saves Sales and documents: only that tab changes, audited with the tab named", async () => {
    const store = await open("summit", await holderOf("summit", DANA, "accountant"));
    const before = (await store.getSettings()).localization;
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    const value = await documentsOf(store, { legalFooter: "LD11 Summit Floor Company LLC." });
    await store.updateLocalization("documents", value);
    const after = (await store.getSettings()).localization;
    expect(after.documents).toEqual(value);
    expect({ ...after, documents: null }).toEqual({ ...before, documents: null });
    const added = (await store.list("audit")).filter((row) => !seen.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      category: "settings",
      action: "Changed localization and tax",
      target: "Sales and documents",
    });
  });

  it("LD12 Payroll rules: California refused while switched off, and a holiday state must be a US state", async () => {
    const store = await open("summit", DANA);
    await expect(
      store.updateLocalization("payroll", { overtimeRule: "california", holidayState: "CO" }),
    ).rejects.toThrow(overtimeRuleProblem("california")!);
    await expect(store.updateLocalization("payroll", { overtimeRule: "federal", holidayState: "XX" })).rejects.toThrow(
      PAYROLL_MESSAGES.holidayState,
    );
  });

  it("LD13 the whole-section save is refused, even a value every tab's rule takes; nothing is stored or audited (part 3b)", async () => {
    const store = await open("summit", DANA);
    const before = structuredClone((await store.getSettings()).localization);
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    await expect(store.updateSettings("localization", before)).rejects.toThrow(SECTION_REFUSAL);
    await expect(
      store.updateSettings("localization", { ...before, documents: { ...before.documents, lateFeePct: "12." } }),
    ).rejects.toThrow(SECTION_REFUSAL);
    expect((await store.getSettings()).localization).toEqual(before);
    expect((await store.list("audit")).filter((row) => !seen.has(row.id))).toEqual([]);
  });
});

describe("DemoStore refuses Localization and tax saved whole (ADR 0059, part 3b)", () => {
  it("WD1 the refusal comes after the keys, switch and scope; neither key alone saves another tab's settings", async () => {
    const priya = await open("summit", PRIYA);
    const whole = structuredClone((await priya.getSettings()).localization);
    await expect(priya.updateSettings("localization", whole)).rejects.toThrow(ROLE_REFUSAL);
    const branch = await viewingAs(["settings.localization.manage"], "branch");
    await expect(branch.updateSettings("localization", whole)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
    OFF.add("settings.localization");
    const off = await open("summit", DANA);
    await expect(off.updateSettings("localization", whole)).rejects.toThrow("This feature is switched off.");
    OFF.clear();
    // Before part 3b either key saved every tab here: Sales tax's key a late fee, the localization key a tax rate.
    const taxOnly = await viewingAs(["settings.tax.manage"]);
    await expect(
      taxOnly.updateSettings("localization", { ...whole, documents: { ...whole.documents, lateFeePct: "2" } }),
    ).rejects.toThrow(SECTION_REFUSAL);
    expect((await taxOnly.getSettings()).localization).toEqual(whole);
    const localOnly = await viewingAs(["settings.localization.manage"]);
    const [first, ...rest] = whole.tax.rules;
    const changedTax = { ...whole.tax, rules: [{ ...first!, ratePct: "9" }, ...rest] };
    await expect(localOnly.updateSettings("localization", { ...whole, tax: changedTax })).rejects.toThrow(
      SECTION_REFUSAL,
    );
    expect((await localOnly.getSettings()).localization).toEqual(whole);
    // Platform module: an HR Suite company reaches the refusal too.
    const harbor = await open("harbor", HARBOR_OWNER);
    await expect(harbor.updateSettings("localization", (await harbor.getSettings()).localization)).rejects.toThrow(
      SECTION_REFUSAL,
    );
  });

  it("WD2 resetSettings('localization') is refused too; another section still resets", async () => {
    const store = await open("summit", DANA);
    const before = structuredClone((await store.getSettings()).localization);
    await expect(store.resetSettings("localization")).rejects.toThrow(SECTION_REFUSAL);
    expect((await store.getSettings()).localization).toEqual(before);
    const original = (await store.getDefaultSettings()).numbers;
    await store.updateSettings("numbers", {
      ...original,
      negativeStyle: original.negativeStyle === "minus" ? "parens" : "minus",
    });
    await store.resetSettings("numbers");
    expect((await store.getSettings()).numbers).toEqual(original);
  });
});
