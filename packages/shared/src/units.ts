import { D, dec, type Dec, type DecimalInput } from "./money";

/**
 * Units (spec section 1, CLAUDE.md rule 4): area is stored in sq ft and length in ft.
 * Everything else is derived here and nowhere else.
 */
export const SQ_FT_PER_SQ_YD = 9;

/** Selling units a product line can use. */
export type SellUnit = "sq_ft" | "sq_yd" | "carton" | "each" | "step" | "ft" | "hour";

/** Short suffix shown after a quantity. */
export const UNIT_LABELS: Record<SellUnit, string> = {
  sq_ft: "sq ft",
  sq_yd: "sq yd",
  carton: "cartons",
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

/**
 * Selling quantity for a material line from a room area: sq yd for broadloom carpet,
 * whole cartons for boxed goods, sq ft otherwise. Waste is applied first.
 */
export function quantityForArea(
  areaSqFt: DecimalInput,
  wastePct: DecimalInput,
  unit: SellUnit,
  sqFtPerCarton?: DecimalInput,
): Dec {
  const gross = withWaste(areaSqFt, wastePct);
  if (unit === "sq_yd") return sqFtToSqYd(gross).toDecimalPlaces(2, D.ROUND_CEIL);
  if (unit === "carton") return dec(cartonsForArea(gross, sqFtPerCarton ?? 1));
  return gross.toDecimalPlaces(2, D.ROUND_CEIL);
}

/** Leftover pieces shorter than this become remnants after a cut (spec "Inventory and roll detail"). */
export const REMNANT_THRESHOLD_FT = 12;
