import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  NUMBER_KINDS,
  numbersToWire,
  SENSITIVE_FIELDS,
  type ApiSettingsSection,
  type CompanySettings,
  type NumberSettingsWire,
  type SettingsAnswer,
} from "@workspace/shared";
import type { ApiClient } from "@/lib/api/contract";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { fakeApi, type FakeAnswer } from "./fake-api";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** DemoStore's words for a whole Localization and tax save (ADR 0059, part 3b). */
const SECTION_REFUSAL = "Localization and tax saves one tab at a time.";

/** Summit's settings as DemoStore holds them: the demo half of every merge. */
let demo: CompanySettings;

beforeAll(async () => {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
  demo = structuredClone(await store.getSettings());
});

/** What the API serves, different from DemoStore's in every served section. */
function served(): Required<Pick<SettingsAnswer, ApiSettingsSection>> {
  return {
    profile: { ...demo.profile, legalName: "Summit Floor Company (API)", ein: "" },
    numbers: numbersToWire({
      ...demo.numbers,
      negativeStyle: "parens",
      decimals: { ...demo.numbers.decimals, money: 0 },
    }),
    payments: { ...demo.payments, approvalThreshold: "10.00" },
    expenses: { approvalRequired: false, approvalThreshold: "" },
    hr: {
      ...demo.hr,
      showRatesToEmployees: !demo.hr.showRatesToEmployees,
      holidays: [{ date: "2026-12-24", name: "Shop closed" }],
    },
    email: { senderName: "Summit Billing", replyTo: "billing@summit.example", signature: "" },
  };
}

/** The client over a fake API that answers GET /settings with `answer`, and a demo stub with Summit's settings. */
function client(answer: unknown, demoMethods: Partial<ApiClient> = {}, nonGet: FakeAnswer = { status: 200, body: {} }) {
  return fakeApi({ "GET /settings": { status: 200, body: answer } }, () => nonGet, {
    getSettings: async () => structuredClone(demo),
    ...demoMethods,
  });
}

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

const UNSERVED = ["localization", "branding", "inventory", "sharedCosts", "meetings"] as const;

describe("Settings part 1 in api mode (ADR 0059)", () => {
  it("W1 getSettings reads GET /settings: the served sections are the API's, the rest DemoStore's", async () => {
    const answer = served();
    const api = client(answer);
    const settings = await api.client.getSettings();
    expect(api.calls()).toEqual(["GET /settings"]);
    expect(settings.profile).toEqual(answer.profile);
    expect(settings.payments).toEqual(answer.payments);
    expect(settings.expenses).toEqual(answer.expenses);
    expect(settings.hr).toEqual(answer.hr);
    expect(settings.email).toEqual(answer.email);
    expect(settings.numbers).toEqual({
      ...demo.numbers,
      negativeStyle: "parens",
      decimals: { ...demo.numbers.decimals, money: 0 },
    });
    for (const section of UNSERVED) expect(settings[section], section).toEqual(demo[section]);
  });

  it("W2 the merge takes only the served sections it is given, and keeps DemoStore's for the rest", async () => {
    const answer = { ...served(), localization: { holidays: { x: 1 } }, madeUp: { x: 1 } };
    const widened = await client(answer).client.getSettings();
    expect(widened.localization).toEqual(demo.localization);
    expect(widened).not.toHaveProperty("madeUp");
    const narrow: SettingsAnswer = { profile: served().profile, numbers: served().numbers };
    const hr = await client(narrow).client.getSettings();
    expect(hr.payments).toEqual(demo.payments);
    expect(hr.expenses).toEqual(demo.expenses);
    expect(hr.profile).toEqual(narrow.profile);
    // Settings → HR left out (never saved, or no reader): DemoStore's copy stays (ADR 0059, part 5, D7).
    expect(hr.hr).toEqual(demo.hr);
    // Settings → Email left out (not its manager, or its page switched off): DemoStore's copy stays.
    expect(hr.email).toEqual(demo.email);
  });

  it("W3 the number kinds are read tolerantly: an unknown kind is dropped, a missing one takes its default", async () => {
    const wire = served().numbers;
    const odd = {
      ...wire,
      decimals: [...wire.decimals.filter((entry) => entry.kind !== "taxRate"), { kind: "weight", places: 5 }],
    } as NumberSettingsWire;
    const settings = await client({ ...served(), numbers: odd }).client.getSettings();
    expect(Object.keys(settings.numbers.decimals).sort()).toEqual(Object.keys(NUMBER_KINDS).sort());
    expect(settings.numbers.decimals.taxRate).toBe(NUMBER_KINDS.taxRate.default);
    expect(settings.numbers.decimals.money).toBe(0);
  });

  it("W4 updateSettings('numbers') sends the decimals as a list with no reserved name, then reads again", async () => {
    const answer = served();
    const api = client(answer);
    const value = { ...demo.numbers, negativeStyle: "parens" as const };
    const result = await api.client.updateSettings("numbers", value);
    expect(api.sent.map((request) => request.call)).toEqual(["PUT /settings/numbers", "GET /settings"]);
    const body = api.sent[0].body as NumberSettingsWire;
    expect(Array.isArray(body.decimals)).toBe(true);
    expect(body).toEqual(numbersToWire(value));
    expect(keysOf(body).filter((key) => key in SENSITIVE_FIELDS)).toEqual([]);
    expect(result.profile).toEqual(answer.profile);
    expect(result.localization).toEqual(demo.localization);
  });

  it("W5 updateSettings sends the profile, payments, expenses, HR and Email unchanged to their own route", async () => {
    for (const section of ["profile", "payments", "expenses", "hr", "email"] as const) {
      const api = client(served());
      const value = demo[section];
      await api.client.updateSettings(section, value);
      expect(api.sent[0], section).toEqual({ call: `PUT /settings/${section}`, body: value });
    }
  });

  it("W6 every other section stays on DemoStore and sends nothing to the API", async () => {
    const updateSettings = vi.fn(async () => structuredClone(demo));
    const api = client(served(), { updateSettings: updateSettings as ApiClient["updateSettings"] });
    await api.client.updateSettings("localization", demo.localization);
    expect(api.sent).toEqual([]);
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith("localization", demo.localization);
  });

  it("W7 Reset to default and resetSettings stay DemoStore's", () => {
    expect("getDefaultSettings" in API_METHODS).toBe(false);
    expect("resetSettings" in API_METHODS).toBe(false);
  });

  it("WW1 api mode: updateSettings('localization') and resetSettings('localization') reach DemoStore, which refuses them; nothing is sent (part 3b)", async () => {
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    const api = client(served(), {
      updateSettings: store.updateSettings.bind(store) as ApiClient["updateSettings"],
      resetSettings: store.resetSettings.bind(store),
    });
    await expect(api.client.updateSettings("localization", demo.localization)).rejects.toThrow(SECTION_REFUSAL);
    await expect(api.client.resetSettings("localization")).rejects.toThrow(SECTION_REFUSAL);
    expect(api.sent).toEqual([]);
    expect((await store.getSettings()).localization).toEqual(demo.localization);
  });
});

/** What the API serves of localization, different from DemoStore's in both served tabs. */
function servedTabs(): {
  documents: CompanySettings["localization"]["documents"];
  payroll: CompanySettings["localization"]["payroll"];
} {
  return {
    documents: { ...demo.localization.documents, quotePrefix: "QA-", defaultDepositPct: "40" },
    payroll: { ...demo.localization.payroll, holidayState: "WY" },
  };
}

describe("Settings part 2a in api mode: the served localization tabs (ADR 0059)", () => {
  it("LW1 getSettings takes documents and payroll from the answer; tabs the answer leaves out stay DemoStore's", async () => {
    const tabs = servedTabs();
    const settings = await client({ ...served(), localization: tabs }).client.getSettings();
    expect(settings.localization.documents).toEqual(tabs.documents);
    expect(settings.localization.payroll).toEqual(tabs.payroll);
    for (const tab of ["region", "currency", "tax"] as const)
      expect(settings.localization[tab], tab).toEqual(demo.localization[tab]);
  });

  it("LW2 an answer without localization leaves DemoStore's localization whole", async () => {
    const settings = await client(served()).client.getSettings();
    expect(settings.localization).toEqual(demo.localization);
  });

  it("LW3 an answer with only payroll (an Installer) keeps DemoStore's documents", async () => {
    const { payroll } = servedTabs();
    const settings = await client({ ...served(), localization: { payroll } }).client.getSettings();
    expect(settings.localization.payroll).toEqual(payroll);
    expect(settings.localization.documents).toEqual(demo.localization.documents);
  });

  it("LW4 updateLocalization('documents') sends the tab to its own route, then reads again", async () => {
    const tabs = servedTabs();
    const api = client({ ...served(), localization: tabs });
    const result = await api.client.updateLocalization("documents", tabs.documents);
    expect(api.sent).toEqual([
      { call: "PUT /settings/localization/documents", body: tabs.documents },
      { call: "GET /settings", body: undefined },
    ]);
    expect(result.localization.documents).toEqual(tabs.documents);
    expect(result.localization.region).toEqual(demo.localization.region);
  });

  it("LW5 updateLocalization('payroll') sends the tab to its own route", async () => {
    const { payroll } = servedTabs();
    const api = client(served());
    await api.client.updateLocalization("payroll", payroll);
    expect(api.sent[0]).toEqual({ call: "PUT /settings/localization/payroll", body: payroll });
  });
});

/** What the API serves of Region and Currency: the company's control zone and a CAD rate, unlike DemoStore's Summit. */
function servedRegionCurrency(): {
  region: CompanySettings["localization"]["region"];
  currency: CompanySettings["localization"]["currency"];
} {
  return {
    region: { ...demo.localization.region, timeZone: "America/Chicago", dateFormat: "yyyy-MM-dd" },
    currency: { base: "USD", locked: true, extra: [{ code: "CAD", rate: "1.3870", asOf: "2026-11-04" }] },
  };
}

describe("Settings part 2b in api mode: Region and Currency (ADR 0059)", () => {
  it("RW1 getSettings takes Region and Currency from the answer; documents, payroll and tax stay DemoStore's", async () => {
    const { region, currency } = servedRegionCurrency();
    const settings = await client({ ...served(), localization: { region, currency } }).client.getSettings();
    expect(settings.localization.region).toEqual(region);
    expect(settings.localization.currency).toEqual(currency);
    for (const tab of ["documents", "payroll", "tax"] as const)
      expect(settings.localization[tab], tab).toEqual(demo.localization[tab]);
  });

  it("RW2 updateLocalization sends Region and Currency to their own routes, then reads again", async () => {
    const { region, currency } = servedRegionCurrency();
    const regionApi = client({ ...served(), localization: { region } });
    const result = await regionApi.client.updateLocalization("region", region);
    expect(regionApi.sent).toEqual([
      { call: "PUT /settings/localization/region", body: region },
      { call: "GET /settings", body: undefined },
    ]);
    expect(result.localization.region).toEqual(region);
    const currencyApi = client(served());
    await currencyApi.client.updateLocalization("currency", currency);
    expect(currencyApi.sent[0]).toEqual({ call: "PUT /settings/localization/currency", body: currency });
  });

  it("RW3 a refused Currency save rejects with the API's words and reads nothing", async () => {
    const message = "Other currencies can't be added, removed or renamed here. Change only their rates.";
    const api = client(served(), {}, { status: 400, body: { code: "invalid_request", message } });
    await expect(api.client.updateLocalization("currency", servedRegionCurrency().currency)).rejects.toThrow(message);
    expect(api.sent.map((request) => request.call)).toEqual(["PUT /settings/localization/currency"]);
  });
});

/** What the API serves of Sales tax: the tab in force with rates at the columns' scale, unlike DemoStore's Summit. */
function servedTax(): CompanySettings["localization"]["tax"] {
  const tax = demo.localization.tax;
  return {
    ...tax,
    rules: tax.rules.map((rule) => (rule.state === "CO" ? { ...rule, ratePct: "8.81000000", validTo: null } : rule)),
    jurisdictions: tax.jurisdictions.map((rate) => ({ ...rate, id: `0190${rate.id}`, ratePct: "8.25000000" })),
  };
}

describe("Settings part 3a in api mode: Sales tax (ADR 0059)", () => {
  it("TW1 updateLocalization('tax') sends the tab to its own route unchanged, then reads again", async () => {
    const answered = servedTax();
    const updateLocalization = vi.fn(async () => structuredClone(demo));
    const api = client(
      { ...served(), localization: { tax: answered } },
      { updateLocalization: updateLocalization as ApiClient["updateLocalization"] },
    );
    const sent = structuredClone(demo.localization.tax);
    const result = await api.client.updateLocalization("tax", sent);
    expect(api.sent).toEqual([
      { call: "PUT /settings/localization/tax", body: demo.localization.tax },
      { call: "GET /settings", body: undefined },
    ]);
    expect(updateLocalization).not.toHaveBeenCalled();
    expect(result.localization.tax).toEqual(answered);
  });

  it("TW2 getSettings takes Sales tax from the answer, raw rates included; an answer without it keeps DemoStore's", async () => {
    const answered = servedTax();
    const settings = await client({ ...served(), localization: { tax: answered } }).client.getSettings();
    expect(settings.localization.tax).toEqual(answered);
    expect(settings.localization.tax.rules.find((rule) => rule.state === "CO")?.ratePct).toBe("8.81000000");
    for (const tab of ["region", "currency", "documents", "payroll"] as const)
      expect(settings.localization[tab], tab).toEqual(demo.localization[tab]);
    const without = await client({
      ...served(),
      localization: { region: demo.localization.region },
    }).client.getSettings();
    expect(without.localization.tax).toEqual(demo.localization.tax);
  });
});
