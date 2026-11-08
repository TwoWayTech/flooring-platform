import { addDays } from "../../src/dates";
import { dec } from "../../src/money";
import { REMNANT_THRESHOLD_FT, SQ_FT_PER_SQ_YD } from "../../src/units";
import type { Product, Roll, RollCut, User } from "../../src/types";
import type { GenContext } from "./context";
import { warehouseIds } from "./locations";
import { brandCode } from "./vocabulary";

const FULL_ROLLS = 45;
const REMNANTS = 15;
/** Rolls kept under 20 ft so the dashboard's "Needs attention" has low rolls to show. */
const LOW_ROLLS = 3;

/** Cuts taken from a roll, newest last, never using more than the roll held. */
function buildCuts(
  ctx: GenContext,
  originalFt: number,
  receivedAt: string,
  targetLeftFt: number,
  cutters: readonly User[],
) {
  const cuts: RollCut[] = [];
  let left = originalFt;
  let at = receivedAt;
  while (left - targetLeftFt >= 8) {
    const length = Math.min(ctx.rng.int(8, 32), left - targetLeftFt);
    at = addDays(at, ctx.rng.int(3, 20));
    if (at > ctx.anchor) break;
    cuts.push({
      id: ctx.id("cut"),
      at: `${at}T${String(ctx.rng.int(8, 16)).padStart(2, "0")}:15`,
      lengthFt: String(length),
      reference: `INV-${ctx.rng.int(1001, 1220)}`,
      byUserId: ctx.rng.pick(cutters).id,
    });
    left -= length;
  }
  return { cuts, remaining: left };
}

/**
 * 60 carpet rolls: 45 full rolls (100 to 150 ft) with cut histories and 15 remnants under
 * 12 ft (spec section 4). Each roll carries its own cost per sq ft, near the product cost.
 */
export function buildRolls(ctx: GenContext, products: readonly Product[], users: readonly User[]): Roll[] {
  const { rng } = ctx;
  const carpets = products.filter((p) => p.category === "carpet");
  const cutters = users.filter((u) => u.roleIds.some((r) => r.endsWith("warehouse") || r.endsWith("manager")));
  const sites = warehouseIds(ctx.company.id);
  const full: Roll[] = Array.from({ length: FULL_ROLLS }, (_, i) => {
    const product = carpets[i % carpets.length]!;
    const original = rng.int(100, 150);
    const receivedAt = addDays(ctx.anchor, -rng.int(20, 300));
    const target = i < LOW_ROLLS ? rng.int(9, 11) : rng.int(25, original);
    const { cuts, remaining } = buildCuts(ctx, original, receivedAt, target, cutters);
    const costPerSqFt = dec(product.cost)
      .dividedBy(SQ_FT_PER_SQ_YD)
      .times(rng.decimal(0.95, 1.05, 3));
    return {
      id: ctx.id("roll"),
      rollNumber: `${brandCode(product.brand)}-${rng.int(1000, 9999)}`,
      productId: product.id,
      dyeLot: `${rng.int(10, 39)}${rng.pick(["A", "B", "C", "D"])}`,
      widthFt: product.widthFt ?? 12,
      originalLengthFt: String(original),
      remainingLengthFt: String(remaining),
      costPerSqFt: costPerSqFt.toDecimalPlaces(4).toFixed(4),
      locationId: sites[rng.pick([0, 0, 1])]!,
      transferId: null,
      bin: `${rng.pick(["A", "B", "C", "D"])}-${String(rng.int(1, 24)).padStart(2, "0")}`,
      isRemnant: false,
      parentRollId: null,
      receivedAt,
      cuts,
    };
  });
  const remnants: Roll[] = Array.from({ length: REMNANTS }, () => {
    const parent = rng.pick(full);
    const length = rng.decimal(3, REMNANT_THRESHOLD_FT - 0.5, 1);
    return {
      ...parent,
      id: ctx.id("roll"),
      rollNumber: `${parent.rollNumber}-R${rng.int(1, 9)}`,
      originalLengthFt: length,
      remainingLengthFt: length,
      bin: `REM-${String(rng.int(1, 12)).padStart(2, "0")}`,
      isRemnant: true,
      parentRollId: parent.id,
      receivedAt: parent.cuts.at(-1)?.at.slice(0, 10) ?? parent.receivedAt,
      cuts: [],
    };
  });
  return [...full, ...remnants];
}
