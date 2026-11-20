/**
 * The Sales tax tab's rules for both modes (ADR 0059, part 3a; blueprint pp. 20-21, Sales tax, rules
 * 1 and 4; sales.md rules 15 and 18): what a save may send (`taxProblem`) and what it changes
 * (`taxChanges`). A change is never an edit: the rows it replaces end the day before the company's
 * day and the new ones start that day, so a posted document keeps the rate and version it used. The
 * API runs both under the localization row's lock and writes the result to `tax_rules` and
 * `tax_jurisdictions`; DemoStore keeps only what is in force. Imports nothing from `settings/`, so
 * `localization-rules → tax-settings` stays one-way.
 */
import { addDays } from "../dates";
import { sameOptionalDecimal, TAX_RATE_TEXT } from "../decimal-text";
import type { LocalizationSettings } from "../types/settings";
import { isStateCode, stateName, US_STATES, type StateCode } from "../us-pack/states";
import type { TaxCategory, TaxRule } from "../us-pack/tax";
import { countyKey, taxInForce, type CompanyDefaultRate, type JurisdictionRate } from "../us-pack/tax-defaults";

type Tax = LocalizationSettings["tax"];

/** The jsonb part of the tab: everything but the rules and county rates, which live in their tables. */
export type TaxBlock = Omit<Tax, "rules" | "jurisdictions">;

/** A state rule as the tab sends it, before `taxProblem`: the state as plain text. Its dates and version are the save's, taken for their shape only. */
export type TaxRuleInput = Omit<TaxRule, "state"> & { state: string };

/** A county rate as the tab sends it: matched by state and county, never by `id` (D25); its dates are the save's. */
export type JurisdictionInput = Omit<JurisdictionRate, "state"> & { state: string };

/** The Sales tax tab as a save sends it (ADR 0059, part 3a). The stored type is assignable to it. */
export interface TaxInput {
  pricesInclude: string;
  rounding: string;
  rules: TaxRuleInput[];
  jurisdictions: JurisdictionInput[];
  companyDefault: CompanyDefaultRate | null;
  filing: { state: string; frequency: string }[];
  certificateTypes: string[];
}

/** The ways tax may be rounded, as the tab offers them. */
export const TAX_ROUNDINGS = ["invoice", "line"] as const satisfies readonly Tax["rounding"][];

/** How documents apply tax today: on top of prices (`computeTotals`); the only value a change may go to (D28). */
export const TAX_PRICES_APPLIED = "exclusive" satisfies Tax["pricesInclude"];

/** The longest jurisdiction or county-rate name a save takes. */
export const TAX_NAME_MAX = 100;

/** The longest county a save takes. */
export const TAX_COUNTY_MAX = 60;

/** The longest rule note (`rationale`) a save keeps. */
export const TAX_NOTE_MAX = 500;

/** The most county rates one save takes. */
export const TAX_JURISDICTIONS_MAX = 200;

const CATEGORIES: readonly TaxCategory[] = ["material", "labor", "freight", "service"];

/**
 * What Sales tax says about each field it refuses, the same words in both modes (the API answers them
 * as 400 `invalid_request`). No literal state, rate or currency (CLAUDE.md rule 12). No key is named
 * like a cost, margin, rate, pay, wage or limit, so packages/shared declares no field the
 * sensitive-field check (`access-rules.test.ts`) must classify: a rate's words are `rulePercent` and
 * `countyPercent` (as Currency's `exchange`, part 2b B3).
 */
export const TAX_MESSAGES = {
  pricesInclude: "Whether prices include sales tax can't be changed yet: documents add tax on top of prices.",
  rounding: "Choose to round tax once per invoice or on each line.",
  notHere: "Filing frequencies and exemption certificate types aren't changed on this tab.",
  rules: `List at most ${US_STATES.length} state rules, one per state.`,
  ruleState: "Choose a US state for each tax rule.",
  stateOnce: (state: string) => `${stateName(state)} has one tax rule; it is listed twice.`,
  jurisdiction: (state: string) => `Enter the jurisdiction for ${stateName(state)}, up to ${TAX_NAME_MAX} characters.`,
  rulePercent: (state: string) =>
    `Enter the rate for ${stateName(state)} as a percent below 100 with up to 4 decimals, such as 8.25.`,
  rationale: (state: string) => `Keep the note for ${stateName(state)} to ${TAX_NOTE_MAX} characters.`,
  jurisdictions: `List at most ${TAX_JURISDICTIONS_MAX} county rates.`,
  countyOnce: "A county rate is listed twice.",
  countyState: "Choose a US state for each county rate.",
  county: `Enter the county for each county rate, such as El Paso, up to ${TAX_COUNTY_MAX} characters.`,
  countyName: (county: string) => `Enter a name for the ${county} county rate, up to ${TAX_NAME_MAX} characters.`,
  countyPercent: (county: string) =>
    `Enter the rate for ${county} as a percent below 100 with up to 4 decimals, such as 8.25.`,
  sameCounty: (county: string, state: string) => `${county}, ${stateName(state)} has two county rates; keep one.`,
  companyDefault: "Enter the company default rate as a percent below 100 with up to 4 decimals, such as 4.",
} as const;

/** Whether a value is a tax rate a save takes (`TAX_RATE_TEXT`, so 0 to 99.9999 by value). */
function isTaxRate(value: unknown): value is string {
  return typeof value === "string" && TAX_RATE_TEXT.test(value);
}

/** Whether a text is not blank once trimmed and, as stored, at most `max` long. */
function textWithin(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

type Filing = readonly { state: string; frequency: string }[];

/** Whether two filing lists say the same, entry by entry. A list missing from old saved demo data reads as none (D30); the API's body requires it. */
function sameFiling(a: Filing = [], b: Filing = []): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((entry, i) => entry.state === b[i]!.state && entry.frequency === b[i]!.frequency)
  );
}

/** Whether two certificate-type lists are the same, in order; a missing one reads as none (D30). */
function sameTexts(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((text, i) => text === b[i]);
}

/** Whether a row's range reaches `day` or later, so a change of its state or county must end it (D26). */
function reaches(row: { validTo?: string | null }, day: string): boolean {
  return !row.validTo || row.validTo >= day;
}

/** The identity of a county rate: its state and county (`countyKey`), never its id (D25). */
function countyOf(rate: { state: string; county: string }): string {
  return `${rate.state}:${countyKey(rate.county)}`;
}

/**
 * Why the state rules can't be saved, or null: at most one per US state, each a state code once,
 * with a jurisdiction, a rate (`TAX_RATE_TEXT`) and a note of at most `TAX_NOTE_MAX` (blueprint p20
 * Sales tax: "jurisdictions and rates with effective dates").
 */
function rulesProblem(rules: readonly TaxRuleInput[]): string | null {
  if (!Array.isArray(rules) || rules.length > US_STATES.length) return TAX_MESSAGES.rules;
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!isStateCode(rule.state)) return TAX_MESSAGES.ruleState;
    if (seen.has(rule.state)) return TAX_MESSAGES.stateOnce(rule.state);
    seen.add(rule.state);
    if (!textWithin(rule.jurisdiction, TAX_NAME_MAX)) return TAX_MESSAGES.jurisdiction(rule.state);
    if (!isTaxRate(rule.ratePct)) return TAX_MESSAGES.rulePercent(rule.state);
    if (typeof rule.rationale !== "string" || rule.rationale.length > TAX_NOTE_MAX)
      return TAX_MESSAGES.rationale(rule.state);
  }
  return null;
}

/**
 * Why the county rates can't be saved, or null: at most `TAX_JURISDICTIONS_MAX`; each id once (the
 * demo stores ids and keys its rows by them); a US state, a county, a name and a rate; and no two for
 * one county of a state (`countyKey`, so "El Paso County" and "el paso" are one county). A county
 * rate with no rule under it is allowed: it applies nowhere until a rule exists (D19).
 */
function jurisdictionsProblem(rates: readonly JurisdictionInput[]): string | null {
  if (!Array.isArray(rates) || rates.length > TAX_JURISDICTIONS_MAX) return TAX_MESSAGES.jurisdictions;
  const ids = new Set<string>();
  const counties = new Set<string>();
  for (const rate of rates) {
    if (ids.has(rate.id)) return TAX_MESSAGES.countyOnce;
    ids.add(rate.id);
    if (!isStateCode(rate.state)) return TAX_MESSAGES.countyState;
    if (!textWithin(rate.county, TAX_COUNTY_MAX)) return TAX_MESSAGES.county;
    const county = rate.county.trim();
    if (!textWithin(rate.name, TAX_NAME_MAX)) return TAX_MESSAGES.countyName(county);
    if (!isTaxRate(rate.ratePct)) return TAX_MESSAGES.countyPercent(county);
    if (counties.has(countyOf(rate))) return TAX_MESSAGES.sameCounty(county, rate.state);
    counties.add(countyOf(rate));
  }
  return null;
}

/** Why the company default can't be saved, or null: none, or a rate `TAX_RATE_TEXT` takes. */
function companyDefaultProblem(companyDefault: CompanyDefaultRate | null): string | null {
  return companyDefault && !isTaxRate(companyDefault.ratePct) ? TAX_MESSAGES.companyDefault : null;
}

/**
 * Why the Sales tax tab can't be saved, or null (ADR 0059, part 3a), the first problem in this order:
 * whether prices include tax may only stay or go back to "exclusive", the only way documents apply
 * tax (D9, D28); rounding is one the tab offers; filing frequencies and certificate types stay the
 * company's (no screen edits them, D10); each state rule a US state once, with a jurisdiction, a rate
 * (`TAX_RATE_TEXT`) and a note of at most 500; each county rate once (by id), in a US state, with a
 * county, a name and a rate, and no two for one county of a state (`countyKey`); the company default's
 * rate. `current` is the tab in force (the API's, read under the row lock; DemoStore's copy); only its
 * block is compared.
 */
export function taxProblem(next: TaxInput, current: TaxBlock): string | null {
  if (next.pricesInclude !== current.pricesInclude && next.pricesInclude !== TAX_PRICES_APPLIED)
    return TAX_MESSAGES.pricesInclude;
  if (!(TAX_ROUNDINGS as readonly string[]).includes(next.rounding)) return TAX_MESSAGES.rounding;
  if (!sameFiling(next.filing, current.filing) || !sameTexts(next.certificateTypes, current.certificateTypes))
    return TAX_MESSAGES.notHere;
  return (
    rulesProblem(next.rules) ?? jurisdictionsProblem(next.jurisdictions) ?? companyDefaultProblem(next.companyDefault)
  );
}

/** The last day of a row a save replaces or removes: the day before the save's (ADR 0059, part 3a, D3). */
export function closesOn(day: string): string {
  return addDays(day, -1);
}

/** The jsonb part of a tab: the rules and county rates live in their tables (data-model "Settings groups"). */
export function taxBlock(tax: Tax): TaxBlock {
  return {
    pricesInclude: tax.pricesInclude,
    rounding: tax.rounding,
    companyDefault: tax.companyDefault,
    filing: tax.filing,
    certificateTypes: tax.certificateTypes,
  };
}

/** What a Sales tax save changes (ADR 0059, part 3a, D2 to D4, D25, D26). */
export interface TaxChanges {
  /** The tab in force after the save, as both modes answer it: unchanged rows as they were, changed and new rows from `day`. */
  after: Tax;
  /** Every row of `current` the save ends: each live rule of a changed or removed state that reaches `day`. The API ends each on `closesOn(day)`. */
  closedRules: TaxRule[];
  /** State rules the save starts on `day`, each with its version; in `after` too. */
  openedRules: TaxRule[];
  /** Every county rate of `current` the save ends: each live row of a changed or removed county that reaches `day`. */
  closedJurisdictions: JurisdictionRate[];
  /** County rates the save starts on `day`; in `after` too. */
  openedJurisdictions: JurisdictionRate[];
}

/** Whether a sent state rule says the same as the one in force: everything but its dates and version, rates by value. */
function sameRule(was: TaxRule, sent: TaxRuleInput): boolean {
  return (
    was.jurisdiction === sent.jurisdiction &&
    sameOptionalDecimal(was.ratePct, sent.ratePct) &&
    CATEGORIES.every((category) => was.taxable[category] === sent.taxable[category]) &&
    was.lumpSumLaborTaxable === sent.lumpSumLaborTaxable &&
    was.rationale === sent.rationale
  );
}

/** Whether a sent county rate says the same as the one in force of its county: county, name and rate by value. */
function sameJurisdiction(was: JurisdictionRate, sent: JurisdictionInput): boolean {
  return was.county === sent.county && was.name === sent.name && sameOptionalDecimal(was.ratePct, sent.ratePct);
}

/** Whether two company defaults say the same: both none, or the rate by value and the four categories. */
function sameDefault(was: CompanyDefaultRate | null, sent: CompanyDefaultRate | null): boolean {
  if (!was || !sent) return !was && !sent;
  return (
    sameOptionalDecimal(was.ratePct, sent.ratePct) &&
    CATEGORIES.every((category) => was.taxable[category] === sent.taxable[category])
  );
}

/**
 * What a Sales tax save of `next` (already passed by `taxProblem`) changes on the company's `day`
 * (ADR 0059, part 3a). `current` is every live row: the API's tables, all versions; DemoStore's copy.
 * A sent state rule is matched with the one in force by state and is the same when its jurisdiction,
 * rate (by value, `sameOptionalDecimal`), taxability, lump-sum flag and note are; a sent county rate is
 * matched by state and county (`countyKey`), never by id (D25), and is the same when its county, name
 * and rate (by value) are. A same row is kept as it is, dates and version included. For a changed or
 * removed state or county, every live row of it that reaches `day` ends (D26), and a changed or new
 * row starts on `day` with no end. A new state rule's version is one above the highest its state ever
 * used: `latest` (the API's, over every row of the table, which its unique index counts) or any row of
 * `current`. New county rates take `makeId()` (the API's uuid v7) or keep the sent id (DemoStore, which
 * keeps only what is in force). The company default, when it changed, is dated `day`. The sent dates,
 * versions and county ids never decide anything (D4, D25).
 */
export function taxChanges(
  next: TaxInput,
  current: Tax,
  day: string,
  options: { latest?: Readonly<Record<string, number>>; makeId?: () => string } = {},
): TaxChanges {
  const inForce = taxInForce(current, day);

  // State rules: matched with the one in force by state.
  const ruleNow = new Map(inForce.rules.map((rule) => [rule.state as string, rule]));
  const touched = new Set<string>();
  const openedRules: TaxRule[] = [];
  for (const sent of next.rules) {
    const was = ruleNow.get(sent.state);
    if (was && sameRule(was, sent)) continue;
    touched.add(sent.state);
    const used = current.rules.filter((rule) => rule.state === sent.state).map((rule) => rule.version);
    openedRules.push({
      // Checked by taxProblem: a US state code.
      state: sent.state as StateCode,
      jurisdiction: sent.jurisdiction,
      ratePct: sent.ratePct,
      taxable: { ...sent.taxable },
      lumpSumLaborTaxable: sent.lumpSumLaborTaxable,
      validFrom: day,
      validTo: null,
      version: Math.max(0, options.latest?.[sent.state] ?? 0, ...used) + 1,
      rationale: sent.rationale,
    });
  }
  const sentStates = new Set(next.rules.map((rule) => rule.state));
  for (const state of ruleNow.keys()) if (!sentStates.has(state)) touched.add(state);
  const closedRules = current.rules.filter((rule) => touched.has(rule.state) && reaches(rule, day));

  // County rates: matched with the one in force by state and county, never by id.
  const rateNow = new Map(inForce.jurisdictions.map((rate) => [countyOf(rate), rate]));
  const touchedCounties = new Set<string>();
  const openedJurisdictions: JurisdictionRate[] = [];
  for (const sent of next.jurisdictions) {
    const was = rateNow.get(countyOf(sent));
    if (was && sameJurisdiction(was, sent)) continue;
    touchedCounties.add(countyOf(sent));
    openedJurisdictions.push({
      id: options.makeId?.() ?? sent.id,
      // Checked by taxProblem: a US state code.
      state: sent.state as StateCode,
      county: sent.county,
      name: sent.name,
      ratePct: sent.ratePct,
      validFrom: day,
      validTo: null,
    });
  }
  const sentCounties = new Set(next.jurisdictions.map(countyOf));
  for (const key of rateNow.keys()) if (!sentCounties.has(key)) touchedCounties.add(key);
  const closedJurisdictions = current.jurisdictions.filter(
    (rate) => touchedCounties.has(countyOf(rate)) && reaches(rate, day),
  );

  // The company default lives in the block: dated the company's day when it changes (D11).
  const companyDefault = sameDefault(current.companyDefault ?? null, next.companyDefault)
    ? current.companyDefault
    : next.companyDefault && {
        ratePct: next.companyDefault.ratePct,
        taxable: { ...next.companyDefault.taxable },
        validFrom: day,
      };

  const after = taxInForce(
    {
      // Checked by taxProblem: "exclusive", or the stored value (D28); a rounding the tab offers.
      pricesInclude: next.pricesInclude as Tax["pricesInclude"],
      rounding: next.rounding as Tax["rounding"],
      companyDefault,
      filing: current.filing,
      certificateTypes: current.certificateTypes,
      rules: [...current.rules.filter((rule) => !closedRules.includes(rule)), ...openedRules],
      jurisdictions: [
        ...current.jurisdictions.filter((rate) => !closedJurisdictions.includes(rate)),
        ...openedJurisdictions,
      ],
    },
    day,
  );
  return { after, closedRules, openedRules, closedJurisdictions, openedJurisdictions };
}
