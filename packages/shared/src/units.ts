import { D, dec, type Dec, type DecimalInput } from "./money";

/**
 * Units (spec section 1, CLAUDE.md rule 4): area is stored in sq ft and length in ft.
 * Everything else is derived here and nowhere else.
 */
export const SQ_FT_PER_SQ_YD = 9;

/** Selling units a product line can use. Area is always sq ft (spec A1); cartons are only a hint beside it. */
export type SellUnit = "sq_ft" | "each" | "step" | "ft" | "hour";

/** Short suffix shown after a quantity. */
export const UNIT_LABELS: Record<SellUnit, string> = {
  sq_ft: "sq ft",
  each: "each",
  step: "steps",
  ft: "ft",
  hour: "h",
};

/** sq ft to sq yd: divide by 9. */
export function sqFtToSqYd(sqFt: DecimalInput): Dec {
  return dec(sqFt).dividedBy(SQ_FT_PER_SQ_YD);
}

/** sq yd to sq ft: multiply by 9. */
export function sqYdToSqFt(sqYd: DecimalInput): Dec {
  return dec(sqYd).times(SQ_FT_PER_SQ_YD);
}

/** Area of a roll or a cut: width ft × length ft, in sq ft. */
export function rollAreaSqFt(widthFt: DecimalInput, lengthFt: DecimalInput): Dec {
  return dec(widthFt).times(lengthFt);
}

/** Adds a waste allowance: 100 sq ft at 10 % waste is 110 sq ft. */
export function withWaste(areaSqFt: DecimalInput, wastePct: DecimalInput): Dec {
  return dec(areaSqFt).times(dec(100).plus(wastePct)).dividedBy(100);
}

/** Whole cartons needed to cover an area; partial cartons round up because cartons are sold whole. */
export function cartonsForArea(areaSqFt: DecimalInput, sqFtPerCarton: DecimalInput): number {
  const per = dec(sqFtPerCarton);
  if (per.lte(0)) throw new Error("Coverage per carton must be positive");
  return dec(areaSqFt).dividedBy(per).toDecimalPlaces(0, D.ROUND_CEIL).toNumber();
}

/** Area of a room rectangle in sq ft. */
export function roomAreaSqFt(widthFt: DecimalInput, lengthFt: DecimalInput): Dec {
  return dec(widthFt).times(lengthFt);
}

/** An area rounded up to whole cartons, in sq ft: 500 sq ft at 23.64 per carton is 22 cartons, 520.08 sq ft. */
export function wholeCartonArea(areaSqFt: DecimalInput, sqFtPerCarton: DecimalInput): Dec {
  return dec(cartonsForArea(areaSqFt, sqFtPerCarton)).times(sqFtPerCarton);
}

/**
 * True when an area is a whole number of cartons (ADR 0027, CLAUDE.md rule 7): boxed stock is
 * only ever whole cartons, so every document, receipt, count and transfer of a boxed good is too.
 */
export function isWholeCartons(areaSqFt: DecimalInput, sqFtPerCarton: DecimalInput): boolean {
  const per = dec(sqFtPerCarton);
  if (per.lte(0)) throw new Error("Coverage per carton must be positive");
  return dec(areaSqFt).dividedBy(per).isInteger();
}

/** What a person does with a boxed line, for the words of `partCartonProblem`. */
export type CartonAction = "sell" | "order" | "receive";

/**
 * The first boxed line whose sq ft is not whole cartons, in words, or null (F-m, ADR 0027). The
 * screens round boxed lines up; the API refuses rather than change a quantity it was sent. The
 * pack is the line's own, copied from the product when the line was written.
 */
export function partCartonProblem(
  lines: readonly { description: string; quantity: string; sqFtPerCarton?: string | null }[],
  action: CartonAction,
): string | null {
  const line = lines.find((l) => l.sqFtPerCarton && !isWholeCartons(l.quantity || "0", l.sqFtPerCarton));
  if (!line) return null;
  return `${line.description}: ${action} whole cartons, multiples of ${dec(line.sqFtPerCarton!).toString()} sq ft.`;
}

/**
 * Billed quantity in sq ft for a material line from a room area (spec A1, plan N-2). Waste is
 * applied first; boxed goods then round up to whole cartons, because cartons are sold whole.
 */
export function quantityForArea(areaSqFt: DecimalInput, wastePct: DecimalInput, sqFtPerCarton?: DecimalInput): Dec {
  const gross = withWaste(areaSqFt, wastePct);
  return sqFtPerCarton ? wholeCartonArea(gross, sqFtPerCarton) : gross.toDecimalPlaces(2, D.ROUND_CEIL);
}

/** What a quantity comes to in cartons (spec A1 "Cartons as a hint"); partial cartons round up. */
export interface CartonEquivalent {
  cartons: number;
  sqFtPerCarton: string;
}

/** The carton equivalent of an area, for the hint beside a quantity. */
export function cartonEquivalent(areaSqFt: DecimalInput, sqFtPerCarton: string): CartonEquivalent {
  return { cartons: cartonsForArea(areaSqFt, sqFtPerCarton), sqFtPerCarton };
}

/**
 * Reads what someone typed in a quantity field (spec A1): "500" is sq ft, and "22c", "22 ctn" or
 * "22 cartons" converts to sq ft when the product comes in cartons. Null when it is not a
 * positive number, or names cartons for a product that has none.
 */
export function parseAreaEntry(raw: string, sqFtPerCarton?: string): Dec | null {
  const match = raw
    .trim()
    .replace(/,/g, "")
    .match(/^(\d*\.?\d+)\s*(c|ctn|ctns|carton|cartons)?$/i);
  if (!match) return null;
  const amount = dec(match[1]!);
  if (amount.lte(0)) return null;
  if (!match[2]) return amount;
  return sqFtPerCarton ? amount.ceil().times(sqFtPerCarton) : null;
}

/** Square feet in one square meter (exact definition: 1 ft = 0.3048 m). */
export const SQ_FT_PER_M2 = "10.76391041670972";

/** The area units a company can work in (spec D1); storage is always sq ft. */
export type AreaUnit = "sq_ft" | "sq_yd" | "m2";

/** Short labels of the area units. */
export const AREA_UNIT_LABELS: Record<AreaUnit, string> = { sq_ft: "sq ft", sq_yd: "sq yd", m2: "m²" };

/** An area in sq ft expressed in another area unit, at full precision. */
export function fromSqFt(sqFt: DecimalInput, unit: AreaUnit): Dec {
  if (unit === "sq_yd") return sqFtToSqYd(sqFt);
  if (unit === "m2") return dec(sqFt).dividedBy(SQ_FT_PER_M2);
  return dec(sqFt);
}

/** An area given in any area unit, converted to sq ft for storage. */
export function toSqFt(value: DecimalInput, unit: AreaUnit): Dec {
  if (unit === "sq_yd") return sqYdToSqFt(value);
  if (unit === "m2") return dec(value).times(SQ_FT_PER_M2);
  return dec(value);
}

/** Leftover pieces shorter than this become remnants after a cut (spec "Inventory and roll detail"). */
export const REMNANT_THRESHOLD_FT = 12;

/** A selling unit in "price per …" phrases, e.g. "per carton". */
export const UNIT_SINGULAR: Record<SellUnit, string> = {
  sq_ft: "sq ft",
  each: "item",
  step: "step",
  ft: "ft",
  hour: "hour",
};

/** Items and steps are whole counts; areas and lengths are quantities with decimals. */
export function quantityKind(unit: SellUnit): "count" | "quantity" {
  return unit === "each" || unit === "step" ? "count" : "quantity";
}
