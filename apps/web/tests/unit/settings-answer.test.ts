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

const UNSERVED = ["localization", "branding", "hr", "email", "inventory", "sharedCosts", "meetings"] as const;

describe("Settings part 1 in api mode (ADR 0059)", () => {
  it("W1 getSettings reads GET /settings: the served sections are the API's, the rest DemoStore's", async () => {
    const answer = served();
    const api = client(answer);
    const settings = await api.client.getSettings();
    expect(api.calls()).toEqual(["GET /settings"]);
    expect(settings.profile).toEqual(answer.profile);
    expect(settings.payments).toEqual(answer.payments);
    expect(settings.expenses).toEqual(answer.expenses);
    expect(settings.numbers).toEqual({
      ...demo.numbers,
      negativeStyle: "parens",
      decimals: { ...demo.numbers.decimals, money: 0 },
    });
    for (const section of UNSERVED) expect(settings[section], section).toEqual(demo[section]);
  });

  it("W2 the merge takes only the served sections it is given, and keeps DemoStore's for the rest", async () => {
    const answer = { ...served(), localization: { tax: { rounding: "line" } }, madeUp: { x: 1 } };
    const widened = await client(answer).client.getSettings();
    expect(widened.localization).toEqual(demo.localization);
    expect(widened).not.toHaveProperty("madeUp");
    const narrow: SettingsAnswer = { profile: served().profile, numbers: served().numbers };
    const hr = await client(narrow).client.getSettings();
    expect(hr.payments).toEqual(demo.payments);
    expect(hr.expenses).toEqual(demo.expenses);
    expect(hr.profile).toEqual(narrow.profile);
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

  it("W5 updateSettings sends the profile, payments and expenses unchanged to their own route", async () => {
    for (const section of ["profile", "payments", "expenses"] as const) {
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

  it("LW6 Sales tax stays on DemoStore and sends nothing to the API", async () => {
    const updateLocalization = vi.fn(async () => structuredClone(demo));
    const api = client(served(), { updateLocalization: updateLocalization as ApiClient["updateLocalization"] });
    await api.client.updateLocalization("tax", demo.localization.tax);
    expect(api.sent).toEqual([]);
    expect(updateLocalization).toHaveBeenCalledTimes(1);
    expect(updateLocalization).toHaveBeenCalledWith("tax", demo.localization.tax);
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
