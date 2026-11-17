import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  CURRENCY_MESSAGES,
  REGION_MESSAGES,
  type CompanySettings,
  type HoldsKey,
  type LocalizationSettings,
} from "@workspace/shared";
import { regionCurrencyForms } from "@/features/settings/localization/simple-tabs";

/** Keystone's fixture localization: PA, states PA, NJ and MD, America/New_York, CAD 1.3870 as of 2026-11-04. */
const ORIGINAL = (
  JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/keystone.json"), "utf8"),
  ) as { settings: CompanySettings }
).settings.localization;

/** The company's current copy, as the API can answer it: another zone and format, a changed CAD, and EUR. */
const CURRENT: LocalizationSettings = {
  ...ORIGINAL,
  region: { ...ORIGINAL.region, timeZone: "America/Chicago", dateFormat: "yyyy-MM-dd" },
  currency: {
    ...ORIGINAL.currency,
    extra: [
      { code: "CAD", rate: "1.4000", asOf: "2026-11-17" },
      { code: "EUR", rate: "1.0800", asOf: "2026-11-17" },
    ],
  },
};

const all: HoldsKey = () => true;
const none: HoldsKey = () => false;

describe("the Region and Currency forms (ADR 0059, part 2b)", () => {
  it("RP1 the rule and the tax key before the code, a code only for a states change, and a Reset that keeps the fixed fields", () => {
    const keyless = regionCurrencyForms(CURRENT, ORIGINAL, none);
    const holder = regionCurrencyForms(CURRENT, ORIGINAL, all);
    const region = CURRENT.region;

    expect(keyless.region.problem(region)).toBeNull();
    const pa = { ...region, statesOfOperation: ["PA"] };
    expect(keyless.region.problem(pa)).toBe(REGION_MESSAGES.statesNeedTax);
    expect(holder.region.problem(pa)).toBeNull();
    expect(keyless.region.problem({ ...pa, timeZone: "America/New_York" })).toBe(REGION_MESSAGES.timeZone);

    expect(keyless.region.stepUp({ ...region, statesOfOperation: ["MD", "NJ", "PA"] })).toBe(false);
    expect(keyless.region.stepUp(pa)).toBe(true);
    expect(keyless.region.stepUp({ ...region, dateFormat: "MM/dd/yyyy" })).toBe(false);

    const currency = CURRENT.currency;
    const zero = { ...currency, extra: currency.extra.map((entry, i) => (i === 0 ? { ...entry, rate: "0" } : entry)) };
    expect(keyless.currency.problem(zero)).toBe(CURRENCY_MESSAGES.exchange("CAD"));
    expect(keyless.currency.problem(currency)).toBeNull();

    // Reset keeps the zone, country and locale from the company's copy and takes the rest from the original.
    expect(keyless.region.defaults).toEqual({
      ...ORIGINAL.region,
      timeZone: "America/Chicago",
      country: region.country,
      locale: region.locale,
    });
    expect(keyless.region.defaults.dateFormat).toBe("MMM d, yyyy");
    expect(keyless.region.defaults.statesOfOperation).toEqual(["PA", "NJ", "MD"]);
    // ... and the base, lock and currencies from the company's copy, each rate from the original when it has one.
    expect(keyless.currency.defaults).toEqual({
      base: currency.base,
      locked: currency.locked,
      extra: [
        { code: "CAD", rate: "1.3870", asOf: "2026-11-04" },
        { code: "EUR", rate: "1.0800", asOf: "2026-11-17" },
      ],
    });
    expect(holder.region.problem(keyless.region.defaults)).toBeNull();
    expect(holder.currency.problem(keyless.currency.defaults)).toBeNull();
  });
});
