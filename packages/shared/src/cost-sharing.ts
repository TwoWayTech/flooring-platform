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

/** The rule in force for a month, naming a fallback when the chosen one has nothing to go on (ADR 0023). */
export function weightsFor(
  locations: readonly Location[],
  settings: SharedCostSettings,
  revenueCents: ReadonlyMap<string, bigint>,
): { rule: SharedCostSettings["rule"]; weights: { id: string; weight: bigint }[] } {
  const by = (fn: (l: Location) => bigint) => locations.map((l) => ({ id: l.id, weight: fn(l) }));
  const total = (w: { weight: bigint }[]) => w.reduce((s, x) => s + x.weight, 0n);
  const area = by((l) =>
    BigInt(
      dec(l.floorAreaSqFt ?? 0)
        .times(100)
        .toFixed(0),
    ),
  );
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
          ? by((l) =>
              BigInt(
                dec(settings.fixedPct[l.id] ?? 0)
                  .times(100)
                  .toFixed(0),
              ),
            )
          : equal;
  if (total(chosen) > 0n) return { rule: settings.rule, weights: chosen };
  if (total(area) > 0n) return { rule: "floor_area", weights: area };
  return { rule: "equal", weights: equal };
}

/** Why the fixed percentages cannot be saved, or null: they must total exactly 100 (ADR 0023). */
export function fixedPctProblem(settings: SharedCostSettings, locations: readonly Location[]): string | null {
  if (settings.rule !== "fixed") return null;
  const total = locations.reduce((s, l) => s.plus(settings.fixedPct[l.id] ?? 0), dec(0));
  return total.eq(100) ? null : `The percentages add up to ${total.toString()}. They must add up to 100.`;
}
