import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_LOCALIZATION_TABS,
  closesOn,
  LOCALIZATION_READERS,
  LOCALIZATION_TABS,
  localizationTabProblem,
  localizationTabStored,
  resolveTaxRule,
  SENSITIVE_FIELDS,
  TAX_COUNTY_MAX,
  TAX_MESSAGES,
  TAX_NAME_MAX,
  TAX_NOTE_MAX,
  TAX_RATE_TEXT,
  TAX_RATE_TEXT_MAX,
  taxBlock,
  taxChanges,
  taxInForce,
  taxProblem,
  US_STATES,
  type CompanySettings,
  type JurisdictionRate,
  type LocalizationSettings,
  type TaxInput,
  type TaxRule,
} from "../src";

type Tax = LocalizationSettings["tax"];

const summit = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8")) as {
  settings: CompanySettings;
};
/** Summit's Sales tax tab: six state rules (version 1 from 2025-01-01), three county rates, a 4 % company default. */
const SUMMIT_TAX: Tax = summit.settings.localization.tax;
/** The company's day these tests save on. */
const DAY = "2026-11-17";
const all = () => true;

/** Summit's rule for a state. */
function ruleOf(state: string): TaxRule {
  return SUMMIT_TAX.rules.find((rule) => rule.state === state)!;
}

/** Summit's county rate with this id. */
function countyRate(id: string): JurisdictionRate {
  return SUMMIT_TAX.jurisdictions.find((rate) => rate.id === id)!;
}

/** Summit's tab with a change, as a save sends it. */
function sent(patch: Partial<TaxInput> = {}): TaxInput {
  return { ...structuredClone(SUMMIT_TAX), ...patch };
}

/** Summit's tab with one state's rule changed. */
function withRule(state: string, patch: Partial<TaxInput["rules"][number]>): TaxInput {
  return sent({ rules: SUMMIT_TAX.rules.map((rule) => (rule.state === state ? { ...rule, ...patch } : rule)) });
}

/** Summit's tab with one county rate changed. */
function withCounty(id: string, patch: Partial<TaxInput["jurisdictions"][number]>): TaxInput {
  return sent({
    jurisdictions: SUMMIT_TAX.jurisdictions.map((rate) => (rate.id === id ? { ...rate, ...patch } : rate)),
  });
}

/** A state rule with a version and range. */
function rule(state: TaxRule["state"], version: number, validFrom: string, validTo: string | null = null): TaxRule {
  return { ...ruleOf("CO"), state, version, validFrom, validTo, ratePct: `${version}` };
}

/** A county rate with an id and range. */
function county(
  id: string,
  state: JurisdictionRate["state"],
  name: string,
  validFrom: string,
  validTo: string | null = null,
): JurisdictionRate {
  return { id, state, county: name, name: `${name} combined`, ratePct: `${id.length}`, validFrom, validTo };
}

/** A rate as the API answers it, at numeric(18,8) scale: "8.81" → "8.81000000" (STATUS B6). */
function scale(text: string): string {
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(8, "0")}`;
}

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

describe("Settings part 3a: the Sales tax tab's rules (ADR 0059, part 3a)", () => {
  it("SR1 TAX_RATE_TEXT takes a percent below 100 with four decimals by value, written with up to eight", () => {
    for (const text of ["0", "8", "8.81", "8.81000000", "8.3100", "08.25", "99.9999", "99.99990000", "6.625"])
      expect(TAX_RATE_TEXT.test(text), text).toBe(true);
    for (const text of [
      "100",
      "8.310001",
      "8.12345",
      "8.810000000",
      "8.",
      ".5",
      "-1",
      "+1",
      "1e1",
      " 8.3",
      "8.3 ",
      "8,3",
      "",
      "0x10",
    ])
      expect(TAX_RATE_TEXT.test(text), text).toBe(false);
    expect("99.99990000").toHaveLength(TAX_RATE_TEXT_MAX);
    expect(TAX_RATE_TEXT.test("9".repeat(TAX_RATE_TEXT_MAX))).toBe(false);
  });

  it("SR2 taxInForce and resolveTaxRule pick the same row: in force on the day, ties by version then id, sorted", () => {
    const rules = [
      rule("PA", 1, "2025-01-01"),
      rule("CO", 1, "2025-01-01", "2026-11-16"),
      rule("TX", 3, "2027-01-01"),
      rule("CO", 2, "2026-11-17"),
      rule("FL", 1, "2025-01-01", "2026-01-31"),
    ];
    const tax: Tax = { ...SUMMIT_TAX, rules, jurisdictions: [] };
    const copy = structuredClone(tax);
    const inForce = taxInForce(tax, DAY);
    expect(inForce.rules.map((r) => [r.state, r.version])).toEqual([
      ["CO", 2],
      ["PA", 1],
    ]);
    expect(tax).toEqual(copy);
    expect(inForce.rounding).toBe(SUMMIT_TAX.rounding);
    expect(inForce.companyDefault).toEqual(SUMMIT_TAX.companyDefault);
    expect(inForce.filing).toEqual(SUMMIT_TAX.filing);

    // Ties (D26): two Colorado rows from one day; the higher version wins, whatever the order.
    for (const order of [
      [rule("CO", 5, "2026-01-01"), rule("CO", 4, "2026-01-01")],
      [rule("CO", 4, "2026-01-01"), rule("CO", 5, "2026-01-01")],
    ]) {
      const tied: Tax = { ...SUMMIT_TAX, rules: order, jurisdictions: [] };
      expect(taxInForce(tied, DAY).rules.map((r) => r.version)).toEqual([5]);
      expect(resolveTaxRule(tied, ["CO"], { state: "CO" }, DAY).rule?.version).toBe(5);
    }

    // County rates: one closed, one later, El Paso twice from one day (the higher id wins).
    const elPasoA = { ...county("a", "CO", "El Paso", "2026-01-01"), ratePct: "7" };
    const elPasoB = { ...county("b", "CO", "El Paso County", "2026-01-01"), ratePct: "9" };
    for (const order of [
      [elPasoA, elPasoB],
      [elPasoB, elPasoA],
    ]) {
      const jurisdictions = [
        county("allegheny", "PA", "Allegheny", "2025-01-01"),
        county("closed", "CO", "Adams", "2025-01-01", "2026-01-31"),
        county("later", "CO", "Denver", "2027-01-01"),
        ...order,
      ];
      const counties: Tax = { ...SUMMIT_TAX, rules: [rule("CO", 1, "2025-01-01")], jurisdictions };
      expect(taxInForce(counties, DAY).jurisdictions.map((rate) => rate.id)).toEqual(["b", "allegheny"]);
      const resolved = resolveTaxRule(counties, ["CO"], { state: "CO", county: "El Paso County" }, DAY);
      expect(resolved.rule?.ratePct).toBe("9");
    }
  });

  it("SR3 taxProblem: each refusal with its words, in order", () => {
    const current = SUMMIT_TAX;
    const co = ruleOf("CO");
    const elPaso = countyRate("jur-co-el-paso");
    expect(taxProblem(sent(), current)).toBeNull();
    const scaled = sent({
      rules: SUMMIT_TAX.rules.map((r) => ({ ...r, ratePct: scale(r.ratePct) })),
      jurisdictions: SUMMIT_TAX.jurisdictions.map((j) => ({ ...j, ratePct: scale(j.ratePct) })),
      companyDefault: { ...SUMMIT_TAX.companyDefault!, ratePct: "4.00000000" },
    });
    expect(scaled.rules[0]!.ratePct).toBe("8.81000000");
    expect(taxProblem(scaled, current)).toBeNull();

    // Prices may only stay or go back to "exclusive" (D9, D28).
    expect(taxProblem(sent({ pricesInclude: "inclusive" }), current)).toBe(TAX_MESSAGES.pricesInclude);
    const inclusive = { ...current, pricesInclude: "inclusive" as const };
    expect(taxProblem(sent({ pricesInclude: "exclusive" }), inclusive)).toBeNull();
    expect(taxProblem(sent({ pricesInclude: "inclusive" }), inclusive)).toBeNull();
    expect(taxProblem(sent({ pricesInclude: "sometimes" }), current)).toBe(TAX_MESSAGES.pricesInclude);

    expect(taxProblem(sent({ rounding: "nearest" }), current)).toBe(TAX_MESSAGES.rounding);

    // Filing and certificate types are the company's (D10); order of keys in an entry doesn't matter.
    expect(taxProblem(sent({ filing: [{ state: "CO", frequency: "quarterly" }, current.filing[1]!] }), current)).toBe(
      TAX_MESSAGES.notHere,
    );
    expect(taxProblem(sent({ filing: [...current.filing, { state: "TX", frequency: "monthly" }] }), current)).toBe(
      TAX_MESSAGES.notHere,
    );
    expect(taxProblem(sent({ certificateTypes: ["Resale certificate"] }), current)).toBe(TAX_MESSAGES.notHere);
    const reordered = current.filing.map((entry) => ({ frequency: entry.frequency, state: entry.state }));
    expect(taxProblem(sent({ filing: reordered }), current)).toBeNull();
    // Saved demo data older than the lists reads a missing one as none (D30).
    const old = { ...current } as Partial<Tax>;
    delete old.filing;
    delete old.certificateTypes;
    const oldNext = sent() as Partial<TaxInput>;
    delete oldNext.filing;
    delete oldNext.certificateTypes;
    expect(taxProblem(oldNext as TaxInput, old as Tax)).toBeNull();

    expect(taxProblem(withRule("CO", { state: "XX" }), current)).toBe(TAX_MESSAGES.ruleState);
    expect(taxProblem(sent({ rules: [...SUMMIT_TAX.rules, co] }), current)).toBe(TAX_MESSAGES.stateOnce("CO"));
    for (const jurisdiction of ["", "   ", "x".repeat(TAX_NAME_MAX + 1)])
      expect(taxProblem(withRule("CO", { jurisdiction }), current), jurisdiction).toBe(TAX_MESSAGES.jurisdiction("CO"));
    expect(taxProblem(withRule("CO", { jurisdiction: "x".repeat(TAX_NAME_MAX) }), current)).toBeNull();
    expect(taxProblem(withRule("CO", { ratePct: "8.123456" }), current)).toBe(TAX_MESSAGES.rulePercent("CO"));
    expect(taxProblem(withRule("CO", { rationale: "x".repeat(TAX_NOTE_MAX + 1) }), current)).toBe(
      TAX_MESSAGES.rationale("CO"),
    );
    expect(taxProblem(withRule("CO", { rationale: "" }), current)).toBeNull();
    const many = US_STATES.map(([state]) => ({ ...co, state }));
    expect(taxProblem(sent({ rules: [...many, co] }), current)).toBe(TAX_MESSAGES.rules);

    expect(
      taxProblem(sent({ jurisdictions: [elPaso, { ...countyRate("jur-pa-allegheny"), id: elPaso.id }] }), current),
    ).toBe(TAX_MESSAGES.countyOnce);
    expect(taxProblem(withCounty("jur-co-el-paso", { state: "ZZ" }), current)).toBe(TAX_MESSAGES.countyState);
    expect(taxProblem(withCounty("jur-co-el-paso", { county: "" }), current)).toBe(TAX_MESSAGES.county);
    expect(taxProblem(withCounty("jur-co-el-paso", { county: "x".repeat(TAX_COUNTY_MAX + 1) }), current)).toBe(
      TAX_MESSAGES.county,
    );
    expect(taxProblem(withCounty("jur-co-el-paso", { name: "" }), current)).toBe(TAX_MESSAGES.countyName("El Paso"));
    expect(taxProblem(withCounty("jur-co-el-paso", { ratePct: "100" }), current)).toBe(
      TAX_MESSAGES.countyPercent("El Paso"),
    );
    const twice = { ...elPaso, id: "jur-other", county: "el paso county" };
    expect(taxProblem(sent({ jurisdictions: [elPaso, twice] }), current)).toBe(
      TAX_MESSAGES.sameCounty("el paso county", "CO"),
    );
    expect(taxProblem(sent({ jurisdictions: [elPaso, { ...twice, state: "TX" }] }), current)).toBeNull();

    expect(taxProblem(sent({ companyDefault: { ...SUMMIT_TAX.companyDefault!, ratePct: "4.00001" } }), current)).toBe(
      TAX_MESSAGES.companyDefault,
    );
    expect(taxProblem(sent({ companyDefault: null }), current)).toBeNull();

    // Content order: prices first, before a bad rate.
    expect(taxProblem({ ...withRule("CO", { ratePct: "8.123456" }), pricesInclude: "inclusive" }, current)).toBe(
      TAX_MESSAGES.pricesInclude,
    );
    // Anything at all is refused with words, never a throw.
    expect(taxProblem({ anything: true } as unknown as TaxInput, current)).toBe(TAX_MESSAGES.pricesInclude);
  });

  it("SR4 taxChanges: versions from the day, every live row reaching the day ends, identity by state and county", () => {
    // 1. Unchanged by value: nothing closed or opened.
    const scaled = sent({
      rules: SUMMIT_TAX.rules.map((r) => ({ ...r, ratePct: scale(r.ratePct) })),
      jurisdictions: SUMMIT_TAX.jurisdictions.map((j) => ({ ...j, ratePct: scale(j.ratePct) })),
    });
    const same = taxChanges(scaled, SUMMIT_TAX, DAY);
    expect([same.closedRules, same.openedRules, same.closedJurisdictions, same.openedJurisdictions]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect(same.after).toEqual(taxInForce(SUMMIT_TAX, DAY));

    // 2. A changed rate: CO v1 ends, v2 starts on the day; the sent dates and version are ignored.
    const co = withRule("CO", { ratePct: "8.5", validFrom: "1999-01-01", version: 42 });
    const changed = taxChanges(co, SUMMIT_TAX, DAY);
    expect(changed.closedRules).toEqual([ruleOf("CO")]);
    expect(changed.openedRules).toEqual([
      { ...ruleOf("CO"), ratePct: "8.5", validFrom: DAY, validTo: null, version: 2 },
    ]);
    expect(taxChanges(co, SUMMIT_TAX, DAY, { latest: { CO: 7 } }).openedRules[0]!.version).toBe(8);
    expect(changed.after.rules.find((r) => r.state === "CO")).toEqual(changed.openedRules[0]);

    // 3. Removed, then added back: the state's numbering continues.
    const removed = taxChanges(sent({ rules: SUMMIT_TAX.rules.filter((r) => r.state !== "CO") }), SUMMIT_TAX, DAY);
    expect(removed.closedRules).toEqual([ruleOf("CO")]);
    expect(removed.openedRules).toEqual([]);
    expect(removed.after.rules.map((r) => r.state)).not.toContain("CO");
    const withoutCo: Tax = { ...SUMMIT_TAX, rules: SUMMIT_TAX.rules.filter((r) => r.state !== "CO") };
    expect(taxChanges(sent(), withoutCo, DAY, { latest: { CO: 2 } }).openedRules.map((r) => r.version)).toEqual([3]);
    expect(taxChanges(sent(), withoutCo, DAY).openedRules.map((r) => [r.state, r.version])).toEqual([["CO", 1]]);

    // 4. Every other field of a rule is compared too.
    for (const patch of [
      { taxable: { ...ruleOf("CO").taxable, labor: true } },
      { lumpSumLaborTaxable: false },
      { jurisdiction: "Denver metro" },
      { rationale: "Reviewed." },
    ]) {
      const result = taxChanges(withRule("CO", patch), SUMMIT_TAX, DAY);
      expect(
        result.openedRules.map((r) => [r.state, r.version]),
        JSON.stringify(patch),
      ).toEqual([["CO", 2]]);
      expect(result.closedRules, JSON.stringify(patch)).toEqual([ruleOf("CO")]);
    }

    // 5. County rates (D25): matched by state and county, never by id.
    const makeId = () => "new-id";
    for (const body of [
      withCounty("jur-co-el-paso", { ratePct: "8.25000000" }),
      withCounty("jur-co-el-paso", { id: "jur-abcdef12" }),
    ]) {
      const kept = taxChanges(body, SUMMIT_TAX, DAY, { makeId });
      expect([kept.closedJurisdictions, kept.openedJurisdictions]).toEqual([[], []]);
    }
    const elPaso = countyRate("jur-co-el-paso");
    const eight = taxChanges(withCounty("jur-co-el-paso", { ratePct: "8" }), SUMMIT_TAX, DAY, { makeId });
    expect(eight.closedJurisdictions).toEqual([elPaso]);
    expect(eight.openedJurisdictions).toEqual([
      { ...elPaso, id: "new-id", ratePct: "8", validFrom: DAY, validTo: null },
    ]);
    expect(
      taxChanges(withCounty("jur-co-el-paso", { ratePct: "8" }), SUMMIT_TAX, DAY).openedJurisdictions.map((j) => j.id),
    ).toEqual(["jur-co-el-paso"]);
    const adams = { ...elPaso, id: "jur-tmp", county: "Adams", name: "Adams County combined", ratePct: "7" };
    const added = sent({ jurisdictions: [...SUMMIT_TAX.jurisdictions, adams] });
    expect(taxChanges(added, SUMMIT_TAX, DAY, { makeId }).openedJurisdictions.map((j) => j.id)).toEqual(["new-id"]);
    expect(taxChanges(added, SUMMIT_TAX, DAY).openedJurisdictions.map((j) => j.id)).toEqual(["jur-tmp"]);
    const foreign = sent({ jurisdictions: [...SUMMIT_TAX.jurisdictions, { ...adams, id: "some-other-company-id" }] });
    const named = taxChanges(foreign, SUMMIT_TAX, DAY, { makeId });
    expect(named.closedJurisdictions).toEqual([]);
    expect(named.openedJurisdictions.map((j) => [j.id, j.county])).toEqual([["new-id", "Adams"]]);
    const allegheny = sent({ jurisdictions: SUMMIT_TAX.jurisdictions.filter((j) => j.id !== "jur-pa-allegheny") });
    expect(taxChanges(allegheny, SUMMIT_TAX, DAY).closedJurisdictions).toEqual([countyRate("jur-pa-allegheny")]);
    const retyped = taxChanges(withCounty("jur-co-el-paso", { county: "el paso" }), SUMMIT_TAX, DAY, { makeId });
    expect(retyped.closedJurisdictions).toEqual([elPaso]);
    expect(retyped.openedJurisdictions.map((j) => [j.id, j.county])).toEqual([["new-id", "el paso"]]);

    // 6. The company default: same by value keeps its date; a change is dated the day.
    const companyDefault = SUMMIT_TAX.companyDefault!;
    expect(taxChanges(sent({ companyDefault: { ...companyDefault, ratePct: "4.0" } }), SUMMIT_TAX, DAY).after).toEqual(
      expect.objectContaining({ companyDefault }),
    );
    expect(
      taxChanges(
        sent({ companyDefault: { ...companyDefault, ratePct: "5", validFrom: "1999-01-01" } }),
        SUMMIT_TAX,
        DAY,
      ).after.companyDefault,
    ).toEqual({ ...companyDefault, ratePct: "5", validFrom: DAY });
    const labor = { ...companyDefault, taxable: { ...companyDefault.taxable, labor: true } };
    expect(taxChanges(sent({ companyDefault: labor }), SUMMIT_TAX, DAY).after.companyDefault).toEqual({
      ...labor,
      validFrom: DAY,
    });
    expect(taxChanges(sent({ companyDefault: null }), SUMMIT_TAX, DAY).after.companyDefault).toBeNull();

    // 7. The answer's shape: sorted; rounding and prices as sent; filing and certificate types the company's.
    const shuffled = sent({
      rules: [...SUMMIT_TAX.rules].reverse(),
      jurisdictions: [...SUMMIT_TAX.jurisdictions].reverse(),
      rounding: "line",
    });
    const after = taxChanges(shuffled, SUMMIT_TAX, DAY).after;
    expect(after.rules.map((r) => r.state)).toEqual(["CO", "FL", "MD", "NJ", "PA", "TX"]);
    expect(after.jurisdictions.map((j) => j.id)).toEqual(["jur-co-el-paso", "jur-pa-allegheny", "jur-pa-philadelphia"]);
    expect(after.rounding).toBe("line");
    const back = taxChanges(sent({ pricesInclude: "exclusive" }), { ...SUMMIT_TAX, pricesInclude: "inclusive" }, DAY);
    expect(back.after.pricesInclude).toBe("exclusive");
    const ownLists = taxChanges(sent({ filing: [], certificateTypes: [] }), SUMMIT_TAX, DAY).after;
    expect([ownLists.filing, ownLists.certificateTypes]).toEqual([SUMMIT_TAX.filing, SUMMIT_TAX.certificateTypes]);

    // 8. Every live row of a changed or removed state reaching the day ends, rows dated later too (D26).
    const v1 = rule("CO", 1, "2025-01-01");
    const v3 = rule("CO", 3, "2027-01-01");
    const v0 = rule("CO", 0, "2024-01-01", "2024-12-31");
    const overlapping: Tax = { ...SUMMIT_TAX, rules: [v0, v1, v3, ruleOf("PA")], jurisdictions: [] };
    const now = sent({ rules: [v1, ruleOf("PA")], jurisdictions: [] });
    const change = taxChanges({ ...now, rules: [{ ...v1, ratePct: "9" }, ruleOf("PA")] }, overlapping, DAY);
    expect(change.closedRules).toEqual([v1, v3]);
    expect(change.openedRules.map((r) => r.version)).toEqual([4]);
    expect(taxChanges({ ...now, rules: [ruleOf("PA")] }, overlapping, DAY).closedRules).toEqual([v1, v3]);
    const unchanged = taxChanges(now, overlapping, DAY);
    expect([unchanged.closedRules, unchanged.openedRules]).toEqual([[], []]);
    const early = county("early", "CO", "El Paso", "2025-01-01");
    const late = county("late", "CO", "El Paso", "2027-01-01");
    const counties: Tax = { ...SUMMIT_TAX, rules: [v1], jurisdictions: [early, late] };
    const moved = taxChanges(sent({ rules: [v1], jurisdictions: [{ ...early, ratePct: "9" }] }), counties, DAY, {
      makeId,
    });
    expect(moved.closedJurisdictions).toEqual([early, late]);
  });

  it("SR5 closesOn is the day before; taxBlock is the jsonb part", () => {
    expect(closesOn("2026-03-01")).toBe("2026-02-28");
    expect(closesOn("2026-01-01")).toBe("2025-12-31");
    expect(Object.keys(taxBlock(SUMMIT_TAX)).sort()).toEqual([
      "certificateTypes",
      "companyDefault",
      "filing",
      "pricesInclude",
      "rounding",
    ]);
    expect(taxBlock(SUMMIT_TAX).companyDefault).toEqual(SUMMIT_TAX.companyDefault);
  });

  it("SR6 the dispatchers run Sales tax's rule and versioning", () => {
    const none = () => false;
    expect(localizationTabProblem("tax", withRule("CO", { ratePct: "8.123456" }) as Tax, SUMMIT_TAX, none)).toBe(
      TAX_MESSAGES.rulePercent("CO"),
    );
    expect(localizationTabProblem("tax", SUMMIT_TAX, SUMMIT_TAX, all)).toBeNull();
    const changed = withRule("CO", { ratePct: "8.5" }) as Tax;
    expect(localizationTabStored("tax", changed, SUMMIT_TAX, DAY)).toEqual(taxChanges(changed, SUMMIT_TAX, DAY).after);
  });

  it("SR7 every tab is served; Sales tax to quote readers and tax managers, never hidden by the page switch", () => {
    expect([...API_LOCALIZATION_TABS].sort()).toEqual(Object.keys(LOCALIZATION_TABS).sort());
    expect(LOCALIZATION_READERS.tax).toEqual({
      readers: ["sales.quote.view", "settings.tax.manage"],
      hiddenWhenOff: false,
    });
    expect(LOCALIZATION_TABS.tax.module).toBe("platform");
  });

  it("SR8 no reserved names: the tab's properties and the message keys pass the sensitive-field scan", () => {
    expect(keysOf(SUMMIT_TAX).filter((key) => key in SENSITIVE_FIELDS)).toEqual([]);
    const pattern = /^(?:[a-zA-Z]*(?:[Cc]ost|[Mm]argin|[Rr]ate|[Ss]alary|[Ww]age|[Ll]imit|[Pp]ay)[a-zA-Z]*)$/;
    expect(Object.keys(TAX_MESSAGES).filter((key) => pattern.test(key))).toEqual([]);
  });
});
