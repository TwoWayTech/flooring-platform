import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENCY_MESSAGES,
  currencyProblem,
  DATE_FORMATS,
  datedRates,
  DOCUMENT_MESSAGES,
  FX_RATE_TEXT,
  FX_RATE_TEXT_MAX,
  localizationTabProblem,
  localizationTabStored,
  PAYROLL_MESSAGES,
  REGION_MESSAGES,
  regionKeyProblem,
  regionProblem,
  SENSITIVE_FIELDS,
  settingsSectionProblem,
  statesOfOperationChanged,
  WEEK_STARTS,
  type CompanySettings,
  type CurrencyInput,
  type HoldsKey,
  type LocalizationSettings,
  type PermissionKey,
  type RegionInput,
} from "../src";

/** A company's fixture settings. */
function fixture(name: "summit" | "keystone"): CompanySettings {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { settings: CompanySettings }).settings;
}

const SUMMIT = fixture("summit").localization;
const KEYSTONE = fixture("keystone").localization;
/** Summit's region: CO, states CO and WY, America/Denver, en-US. */
const REGION = SUMMIT.region;
/** Keystone's currency: USD, locked, CAD at 1.3870 as of 2026-11-04. */
const CURRENCY = KEYSTONE.currency;

const all: HoldsKey = () => true;
const none: HoldsKey = () => false;
const only =
  (...held: PermissionKey[]): HoldsKey =>
  (key) =>
    held.includes(key);

/** Summit's region with a change, as a save sends it. */
function region(patch: Partial<RegionInput>): RegionInput {
  return { ...REGION, ...patch };
}

/** A region a save sends, as the stored type the dispatchers take: a refused value doesn't fit it. */
function asRegion(value: RegionInput): LocalizationSettings["region"] {
  return value as LocalizationSettings["region"];
}

/** Keystone's currency with CAD's rate (and optionally its sent `asOf`) replaced. */
function cad(rate: string, asOf = CURRENCY.extra[0]!.asOf): LocalizationSettings["currency"] {
  return { ...CURRENCY, extra: [{ code: "CAD", rate, asOf }] };
}

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/** Rates `FX_RATE_TEXT` refuses: zero is refused by `currencyProblem`'s "above 0". */
const BAD_RATES = ["-1", "1.", ".5", "1e3", " 1", "", "1.123456789", "12345678901", "0x10", "1,5"];

describe("Settings part 2b: Region and Currency rules (ADR 0059)", () => {
  it("RG1 regionProblem accepts the stored region, a reorder, every month bound, date format and week start", () => {
    expect(regionProblem(REGION, REGION)).toBeNull();
    expect(regionProblem(region({ statesOfOperation: ["WY", "CO"] }), REGION)).toBeNull();
    for (const fiscalYearStartMonth of [1, 12])
      expect(regionProblem(region({ fiscalYearStartMonth }), REGION), String(fiscalYearStartMonth)).toBeNull();
    for (const dateFormat of DATE_FORMATS) expect(regionProblem(region({ dateFormat }), REGION), dateFormat).toBeNull();
    for (const firstDayOfWeek of WEEK_STARTS)
      expect(regionProblem(region({ firstDayOfWeek }), REGION), firstDayOfWeek).toBeNull();
    expect(regionProblem(region({ primaryState: "UT" }), REGION)).toBeNull();
  });

  it("RG2 regionProblem refuses each field with its own words, against the stored region", () => {
    for (const timeZone of ["America/Chicago", "Europe/Paris", ""])
      expect(regionProblem(region({ timeZone }), REGION), timeZone).toBe(REGION_MESSAGES.timeZone);
    // The rule compares with `current`: a body with the row's Denver is refused when the company's zone is Chicago.
    expect(regionProblem(REGION, { ...REGION, timeZone: "America/Chicago" })).toBe(REGION_MESSAGES.timeZone);
    expect(regionProblem(region({ country: "CA" }), REGION)).toBe(REGION_MESSAGES.countryLocale("US", "en-US"));
    expect(regionProblem(region({ locale: "en-CA" }), REGION)).toBe(REGION_MESSAGES.countryLocale("US", "en-US"));
    expect(REGION_MESSAGES.countryLocale("US", "en-US")).toBe(
      "The region keeps the company's country and locale (US, en-US).",
    );
    expect(regionProblem(REGION, { ...REGION, locale: "en-CA" })).toBe(REGION_MESSAGES.countryLocale("US", "en-CA"));
    for (const primaryState of ["XX", "co", ""])
      expect(regionProblem(region({ primaryState }), REGION), primaryState).toBe(REGION_MESSAGES.primaryState);
    for (const statesOfOperation of [[], ["CO", "CO"], ["CO", "ZZ"], ["co"]])
      expect(regionProblem(region({ statesOfOperation }), REGION), statesOfOperation.join()).toBe(
        REGION_MESSAGES.statesOfOperation,
      );
    expect(regionProblem(region({ dateFormat: "dd/MM/yyyy" }), REGION)).toBe(REGION_MESSAGES.dateFormat);
    expect(regionProblem(region({ firstDayOfWeek: "friday" }), REGION)).toBe(REGION_MESSAGES.firstDayOfWeek);
    for (const fiscalYearStartMonth of [0, 13, 1.5, Number.NaN])
      expect(regionProblem(region({ fiscalYearStartMonth }), REGION), String(fiscalYearStartMonth)).toBe(
        REGION_MESSAGES.fiscalYearStartMonth,
      );
    // The zone is judged first.
    expect(regionProblem(region({ timeZone: "Europe/Paris", dateFormat: "dd/MM/yyyy" }), REGION)).toBe(
      REGION_MESSAGES.timeZone,
    );
  });

  it("RG3 statesOfOperationChanged compares as sets; regionKeyProblem asks for the sales tax key only for a change", () => {
    const current = { statesOfOperation: ["CO", "WY"] };
    expect(statesOfOperationChanged({ statesOfOperation: ["WY", "CO"] }, current)).toBe(false);
    expect(statesOfOperationChanged({ statesOfOperation: ["CO", "WY"] }, current)).toBe(false);
    expect(statesOfOperationChanged({ statesOfOperation: ["CO"] }, current)).toBe(true);
    expect(statesOfOperationChanged({ statesOfOperation: ["CO", "WY", "UT"] }, current)).toBe(true);
    expect(statesOfOperationChanged({ statesOfOperation: ["CO", "UT"] }, current)).toBe(true);
    expect(statesOfOperationChanged(current, { statesOfOperation: ["CO"] })).toBe(true);
    expect(statesOfOperationChanged(current, { statesOfOperation: ["CO", "WY", "UT"] })).toBe(true);

    const changed = region({ statesOfOperation: ["CO"] });
    expect(regionKeyProblem(changed, REGION, none)).toBe(REGION_MESSAGES.statesNeedTax);
    expect(regionKeyProblem(changed, REGION, only("settings.localization.manage"))).toBe(REGION_MESSAGES.statesNeedTax);
    expect(regionKeyProblem(changed, REGION, all)).toBeNull();
    expect(regionKeyProblem(changed, REGION, only("settings.tax.manage"))).toBeNull();
    expect(regionKeyProblem(region({ statesOfOperation: ["WY", "CO"], dateFormat: "yyyy-MM-dd" }), REGION, none)).toBe(
      null,
    );
    expect(REGION_MESSAGES.statesNeedTax).toBe(
      "Changing the states of operation changes where sales tax is collected, so it also needs the sales tax permission.",
    );
  });

  it("RG4 currencyProblem accepts the stored currency and plain rates above 0 with up to 8 decimals", () => {
    expect(currencyProblem(CURRENCY, CURRENCY)).toBeNull();
    for (const rate of ["1.39", "0.00000001", "9999999999.99999999", "2", "1.3870"])
      expect(currencyProblem(cad(rate), CURRENCY), rate).toBeNull();
    expect(currencyProblem(SUMMIT.currency, SUMMIT.currency)).toBeNull();
    // A sent `asOf` is never judged: the save dates rates itself.
    expect(currencyProblem(cad("1.3870", "anything"), CURRENCY)).toBeNull();
  });

  it("RG5 currencyProblem refuses a changed base or lock, changed codes and a rate that isn't plain text above 0", () => {
    expect(currencyProblem({ ...CURRENCY, base: "CAD" }, CURRENCY)).toBe(CURRENCY_MESSAGES.base("USD"));
    expect(currencyProblem({ ...CURRENCY, locked: false }, CURRENCY)).toBe(CURRENCY_MESSAGES.base("USD"));
    expect(CURRENCY_MESSAGES.base("USD")).toBe("The company's base currency stays USD.");
    const entry = CURRENCY.extra[0]!;
    const eur = { code: "EUR", rate: "1.0800", asOf: "2026-11-04" };
    for (const extra of [[entry, eur], [], [{ ...entry, code: "CAN" }], [eur, entry]])
      expect(currencyProblem({ ...CURRENCY, extra }, CURRENCY), extra.map((x) => x.code).join()).toBe(
        CURRENCY_MESSAGES.codes,
      );
    // Two entries reordered are a change of codes too.
    const two = { ...CURRENCY, extra: [entry, eur] };
    expect(currencyProblem({ ...two, extra: [eur, entry] }, two)).toBe(CURRENCY_MESSAGES.codes);
    expect(currencyProblem(two, two)).toBeNull();
    for (const rate of ["0", "0.0", "0.00000000", ...BAD_RATES])
      expect(currencyProblem(cad(rate), CURRENCY), rate).toBe(CURRENCY_MESSAGES.exchange("CAD"));
    expect(CURRENCY_MESSAGES.exchange("CAD")).toBe(
      "Enter the rate for CAD as a number above 0 with up to 8 decimals, such as 1.3870.",
    );
    // The first refused field answers: the base before the codes, the codes before a rate.
    expect(currencyProblem({ ...cad("0"), base: "EUR", extra: [] }, CURRENCY)).toBe(CURRENCY_MESSAGES.base("USD"));
    expect(currencyProblem({ ...CURRENCY, extra: [{ ...entry, code: "CAN", rate: "0" }] }, CURRENCY)).toBe(
      CURRENCY_MESSAGES.codes,
    );
  });

  it("RG6 datedRates: a changed value is dated the day; an unchanged one keeps its entry; a sent asOf is never stored", () => {
    const day = "2026-11-17";
    expect(datedRates(cad("1.387"), CURRENCY, day)).toEqual(CURRENCY);
    expect(datedRates(cad("1.38700000", "1999-01-01"), CURRENCY, day)).toEqual(CURRENCY);
    expect(datedRates(cad("1.4000", "2099-01-01"), CURRENCY, day)).toEqual({
      base: "USD",
      locked: true,
      extra: [{ code: "CAD", rate: "1.4000", asOf: day }],
    });
    expect(datedRates(cad("1.4000", "1999-01-01"), CURRENCY, day).extra[0]!.asOf).toBe(day);
    // Base and lock come from the stored tab.
    const sent: CurrencyInput = { ...cad("1.4000"), base: "EUR", locked: false };
    const stored = datedRates(sent, CURRENCY, day);
    expect([stored.base, stored.locked]).toEqual(["USD", true]);
    // Only the changed entry gets the new day.
    const eur = { code: "EUR", rate: "1.0800", asOf: "2026-11-01" };
    const two = { ...CURRENCY, extra: [CURRENCY.extra[0]!, eur] };
    expect(datedRates({ ...two, extra: [CURRENCY.extra[0]!, { ...eur, rate: "1.1" }] }, two, day).extra).toEqual([
      CURRENCY.extra[0],
      { code: "EUR", rate: "1.1", asOf: day },
    ]);
  });

  it("RG7 the dispatchers: each tab's rule against the stored tab, Region's key after its content; the whole section too", () => {
    expect(localizationTabProblem("region", asRegion(region({ dateFormat: "dd/MM/yyyy" })), REGION, all)).toBe(
      REGION_MESSAGES.dateFormat,
    );
    expect(localizationTabProblem("currency", cad("0"), CURRENCY, all)).toBe(CURRENCY_MESSAGES.exchange("CAD"));
    const changed = asRegion(region({ statesOfOperation: ["CO"] }));
    expect(localizationTabProblem("region", changed, REGION, none)).toBe(REGION_MESSAGES.statesNeedTax);
    expect(localizationTabProblem("region", changed, REGION, all)).toBeNull();
    // Content first: a zone change with no key gives the zone's words.
    expect(localizationTabProblem("region", { ...changed, timeZone: "Europe/Paris" }, REGION, none)).toBe(
      REGION_MESSAGES.timeZone,
    );
    const odd = { anything: true } as unknown as LocalizationSettings["tax"];
    expect(localizationTabProblem("tax", odd, SUMMIT.tax, none)).toBeNull();
    expect(
      localizationTabProblem("documents", { ...SUMMIT.documents, lateFeePct: "12." }, SUMMIT.documents, none),
    ).toBe(DOCUMENT_MESSAGES.lateFeePct);
    expect(
      localizationTabProblem("payroll", { overtimeRule: "federal", holidayState: "XX" }, SUMMIT.payroll, none),
    ).toBe(PAYROLL_MESSAGES.holidayState);

    const day = "2026-11-17";
    expect(localizationTabStored("currency", cad("1.4000"), CURRENCY, day).extra[0]!.asOf).toBe(day);
    expect(localizationTabStored("currency", cad("1.387"), CURRENCY, day)).toEqual(CURRENCY);
    const value = asRegion(region({ dateFormat: "yyyy-MM-dd" }));
    expect(localizationTabStored("region", value, REGION, day)).toBe(value);
    expect(localizationTabStored("payroll", SUMMIT.payroll, SUMMIT.payroll, day)).toBe(SUMMIT.payroll);

    const paris = { ...SUMMIT, region: { ...REGION, timeZone: "Europe/Paris" } };
    expect(settingsSectionProblem("localization", paris, SUMMIT)).toBe(REGION_MESSAGES.timeZone);
    const keystone = { ...SUMMIT, currency: CURRENCY };
    const added = {
      ...keystone,
      currency: { ...CURRENCY, extra: [...CURRENCY.extra, { ...CURRENCY.extra[0]!, code: "EUR" }] },
    };
    expect(settingsSectionProblem("localization", added, keystone)).toBe(CURRENCY_MESSAGES.codes);
    expect(settingsSectionProblem("localization", keystone, keystone)).toBeNull();
    // The whole-section path checks no extra key: a states change passes its content rules.
    expect(settingsSectionProblem("localization", { ...SUMMIT, region: changed }, SUMMIT)).toBeNull();
  });

  it("RG8 FX_RATE_TEXT and the tab's options: the rate pattern, its longest text, the date formats and week starts", () => {
    for (const rate of ["1.39", "0.00000001", "9999999999.99999999", "0", "1"])
      expect(FX_RATE_TEXT.test(rate), rate).toBe(true);
    for (const rate of BAD_RATES) expect(FX_RATE_TEXT.test(rate), rate).toBe(false);
    expect("9999999999.99999999").toHaveLength(FX_RATE_TEXT_MAX);
    expect(FX_RATE_TEXT.test("9".repeat(FX_RATE_TEXT_MAX))).toBe(false);
    expect([...DATE_FORMATS].sort()).toEqual(["MM/dd/yyyy", "MMM d, yyyy", "yyyy-MM-dd"]);
    expect([...WEEK_STARTS].sort()).toEqual(["monday", "sunday"]);
  });

  it("RG9 no property of Region or Currency is a reserved sensitive name", () => {
    // Part 1's "Reserved names" note: the interceptor would strip such a property from the answer.
    expect(keysOf({ region: REGION, currency: CURRENCY }).filter((key) => key in SENSITIVE_FIELDS)).toEqual([]);
  });
});
