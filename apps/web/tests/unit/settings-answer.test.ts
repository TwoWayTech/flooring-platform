import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  NUMBER_KINDS,
  numbersToWire,
  SENSITIVE_FIELDS,
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
function served(): Required<SettingsAnswer> {
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
    const answer = { ...served(), localization: { region: { timeZone: "Europe/Paris" } }, madeUp: { x: 1 } };
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
