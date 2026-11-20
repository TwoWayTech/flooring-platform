import { PERCENT_TEXT, PLAIN_DECIMAL } from "./decimal-text";
import { dec, type Dec } from "./money";
import type { Location, SharedCostSettings } from "./types";

/** Exact whole cents: dollars become a bigint so the split never depends on rounding (ADR 0023). */
export const toCents = (value: Dec | string): bigint => BigInt(dec(value).times(100).toFixed(0));

/** Back to dollars. */
export const fromCents = (cents: bigint): Dec => dec(cents.toString()).dividedBy(100);

/**
 * Splits whole cents by weight using the largest remainder (ADR 0023): everyone gets floor(T × w ÷ W),
 * and the cents left over go to the largest remainders, ties by id. The shares add up to T exactly,
 * and a weight of zero never receives a cent.
 */
export function shareByWeight(total: bigint, weights: readonly { id: string; weight: bigint }[]): Map<string, bigint> {
  const W = weights.reduce((s, w) => s + w.weight, 0n);
  if (W === 0n) return new Map(weights.map((w) => [w.id, 0n]));
  const parts = weights.map((w) => ({ id: w.id, base: (total * w.weight) / W, rest: (total * w.weight) % W }));
  const left = total - parts.reduce((s, p) => s + p.base, 0n);
  const extra = new Set(
    [...parts]
      .sort((a, b) => (a.rest === b.rest ? a.id.localeCompare(b.id) : a.rest > b.rest ? -1 : 1))
      .slice(0, Number(left))
      .map((p) => p.id),
  );
  return new Map(parts.map((p) => [p.id, p.base + (extra.has(p.id) ? 1n : 0n)]));
}

/**
 * How company-wide costs are split when a company has no shared-cost settings row yet: by revenue
 * share, the default of ADR 0023, so the reports never invent another rule.
 */
export const DEFAULT_SHARED_COSTS: Readonly<SharedCostSettings> = Object.freeze({ rule: "revenue", fixedPct: {} });

/**
 * A stored decimal as a whole-number weight at `scale` (a power of ten), or 0 when the text is
 * blank or not plain decimal text (`PLAIN_DECIMAL`) (ADR 0059, part 4b, D7): the report reads rows written before the rules
 * existed (a blank floor area, R5) and must never throw on one.
 */
function weightOf(text: string | undefined, scale: number): bigint {
  if (text === undefined || !PLAIN_DECIMAL.test(text)) return 0n;
  return BigInt(dec(text).times(scale).toFixed(0));
}

/**
 * The rule in force for a month, naming a fallback when the chosen one has nothing to go on (ADR
 * 0023). Floor area weighs in hundredths of a sq ft; a fixed share in ten-thousandths of a percent,
 * so every share `PERCENT_TEXT` takes is exact (ADR 0059, part 4b, D7). A blank or malformed stored
 * value weighs 0.
 */
export function weightsFor(
  locations: readonly Pick<Location, "id" | "floorAreaSqFt">[],
  settings: SharedCostSettings,
  revenueCents: ReadonlyMap<string, bigint>,
): { rule: SharedCostSettings["rule"]; weights: { id: string; weight: bigint }[] } {
  const by = (fn: (l: Pick<Location, "id" | "floorAreaSqFt">) => bigint) =>
    locations.map((l) => ({ id: l.id, weight: fn(l) }));
  const total = (w: { weight: bigint }[]) => w.reduce((s, x) => s + x.weight, 0n);
  const area = by((l) => weightOf(l.floorAreaSqFt, 100));
  const equal = by(() => 1n);
  const chosen =
    settings.rule === "revenue"
      ? by((l) => {
          const r = revenueCents.get(l.id) ?? 0n;
          return r > 0n ? r : 0n;
        })
      : settings.rule === "floor_area"
        ? area
        : settings.rule === "fixed"
          ? by((l) => (Object.hasOwn(settings.fixedPct, l.id) ? weightOf(settings.fixedPct[l.id], 10_000) : 0n))
          : equal;
  if (total(chosen) > 0n) return { rule: settings.rule, weights: chosen };
  if (total(area) > 0n) return { rule: "floor_area", weights: area };
  return { rule: "equal", weights: equal };
}

/** The sharing rules a company may choose (ADR 0023), in the order Settings → Expenses lists them. */
export const SHARED_COST_RULES = ["revenue", "floor_area", "equal", "fixed"] as const;

/** The most location shares one save takes (ADR 0059, part 4b, D4): far above any company's locations. */
export const SHARED_COST_SHARES_MAX = 1000;

/** What Shared costs says about what it refuses, the same words in both modes (ADR 0059, part 4b, D4). */
export const SHARED_COST_MESSAGES = {
  rule: "Choose how company-wide costs are shared: by revenue, by floor area, equally or by fixed percentages.",
  unknownLocation: "A share names a location this company doesn't have. Reload the page and try again.",
  shares: `Give at most ${SHARED_COST_SHARES_MAX} location shares.`,
  share: "Enter each share as a percent from 0 to 100, such as 25 or 12.5.",
  // Names the location whose share is refused.
  shareOf: (name: string) => `Enter ${name}'s share as a percent from 0 to 100, such as 25 or 12.5.`,
  total: (total: string) => `The percentages add up to ${total}. They must add up to 100.`,
} as const;

/** Shared costs as a save sends them, before `sharedCostsProblem` has checked the rule (ADR 0059, part 4b). */
export type SharedCostsInput = Omit<SharedCostSettings, "rule"> & { rule: string };

/** Whether a rule is one of `SHARED_COST_RULES`. */
export function isSharedCostRule(rule: string): rule is SharedCostSettings["rule"] {
  return (SHARED_COST_RULES as readonly string[]).includes(rule);
}

/** Whether a share is plain percent text (`PERCENT_TEXT`) no higher than 100, checked before any `dec`. */
function shareOk(value: unknown): value is string {
  return typeof value === "string" && PERCENT_TEXT.test(value) && dec(value).lte(100);
}

/**
 * Why fixed percentages can't be saved, or null (ADR 0023; ADR 0059, part 4b, D4): with the fixed
 * rule, each live location's share, when given, is a percent from 0 to 100, and the shares add up to
 * exactly 100, by value. A location with no share counts 0. Never throws on malformed text (note (a)).
 */
export function fixedPctProblem(
  settings: SharedCostsInput,
  locations: readonly Pick<Location, "id" | "name">[],
): string | null {
  if (settings.rule !== "fixed") return null;
  let total = dec(0);
  for (const l of locations) {
    if (!Object.hasOwn(settings.fixedPct, l.id)) continue;
    const share = settings.fixedPct[l.id];
    if (!shareOk(share)) return SHARED_COST_MESSAGES.shareOf(l.name);
    total = total.plus(share);
  }
  return total.eq(100) ? null : SHARED_COST_MESSAGES.total(total.toString());
}

/**
 * Why shared costs can't be saved, or null (spec settings-and-permissions.md, `sharedCosts`; ADR
 * 0023; ADR 0059, part 4b, D4 to D6): the rule is a known one; every share names one of `locations`
 * (the company's live locations) and is a percent from 0 to 100, whatever the rule, so nothing
 * malformed is stored; with the fixed rule the shares add up to exactly 100. A location with no share
 * counts 0, and the report splits by the shares it finds. Both modes run it with the same words.
 */
export function sharedCostsProblem(
  value: SharedCostsInput,
  locations: readonly Pick<Location, "id" | "name">[],
): string | null {
  if (!isSharedCostRule(value.rule)) return SHARED_COST_MESSAGES.rule;
  const shares = Object.entries(value.fixedPct);
  if (shares.length > SHARED_COST_SHARES_MAX) return SHARED_COST_MESSAGES.shares;
  const live = new Map(locations.map((l) => [l.id, l.name]));
  for (const [id, share] of shares) {
    const name = live.get(id);
    if (name === undefined) return SHARED_COST_MESSAGES.unknownLocation;
    if (!shareOk(share)) return SHARED_COST_MESSAGES.shareOf(name);
  }
  return fixedPctProblem(value, locations);
}
