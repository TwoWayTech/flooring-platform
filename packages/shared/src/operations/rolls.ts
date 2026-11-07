import { dec } from "../money";
import type { Roll } from "../types";
import { REMNANT_THRESHOLD_FT } from "../units";

/** What a cut records: how much, when, against which document, and by whom. */
export interface CutInput {
  lengthFt: string;
  at: string;
  reference: string;
  byUserId: string;
}

/** The roll after a cut, and the remnant the cut left behind, if any. */
export interface CutResult {
  roll: Roll;
  remnant: Roll | null;
}

/** Why a cut is refused, phrased for the person cutting; null when the cut is allowed. */
export function validateCut(roll: Roll, lengthFt: string): string | null {
  let length;
  try {
    length = dec(lengthFt || "0");
  } catch {
    return "Enter a length in feet, for example 12.5.";
  }
  if (!length.isFinite() || length.lte(0)) return "Enter a length greater than 0 ft.";
  if (length.gt(roll.remainingLengthFt)) return `Only ${roll.remainingLengthFt} ft is left on this roll.`;
  return null;
}

/**
 * Cuts a length from a roll (spec "Inventory and roll detail"). Lengths are in ft (CLAUDE.md
 * rule 4). When a full roll's leftover is under 12 ft, the leftover becomes a remnant with its
 * own number and bin, and the roll is used up; cutting a remnant just shortens it.
 */
export function cutRoll(roll: Roll, input: CutInput, ids: { cutId: string; remnantId: string }): CutResult {
  const problem = validateCut(roll, input.lengthFt);
  if (problem) throw new Error(problem);
  const left = dec(roll.remainingLengthFt).minus(input.lengthFt);
  const cut = {
    id: ids.cutId,
    at: input.at,
    lengthFt: dec(input.lengthFt).toString(),
    reference: input.reference,
    byUserId: input.byUserId,
  };
  const becomesRemnant = !roll.isRemnant && left.gt(0) && left.lt(REMNANT_THRESHOLD_FT);
  const after: Roll = {
    ...roll,
    remainingLengthFt: (becomesRemnant ? dec(0) : left).toString(),
    cuts: [...roll.cuts, cut],
  };
  if (!becomesRemnant) return { roll: after, remnant: null };
  return {
    roll: after,
    remnant: {
      ...roll,
      id: ids.remnantId,
      rollNumber: `${roll.rollNumber}-R${roll.cuts.length + 1}`,
      originalLengthFt: left.toString(),
      remainingLengthFt: left.toString(),
      bin: "Remnant rack",
      isRemnant: true,
      parentRollId: roll.id,
      receivedAt: input.at.slice(0, 10),
      cuts: [],
    },
  };
}
