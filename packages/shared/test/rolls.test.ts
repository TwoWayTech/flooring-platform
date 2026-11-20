import { describe, expect, it } from "vitest";
import { cutRoll, validateCut, type Roll } from "../src";

const roll: Roll = {
  id: "r1",
  rollNumber: "NM-4471",
  productId: "p1",
  dyeLot: "22B",
  widthFt: "12",
  originalLengthFt: "150",
  remainingLengthFt: "63",
  costPerSqFt: "1.8725",
  locationId: "w1",
  bin: "A-03",
  transferId: null,
  isRemnant: false,
  parentRollId: null,
  receivedAt: "2026-06-01",
  cuts: [],
};
const input = { at: "2026-11-07T10:00", reference: "INV-1042", byUserId: "u1" };
const ids = { cutId: "c1", remnantId: "r2" };

describe("cutting a roll", () => {
  it("shortens the roll and records the cut", () => {
    const { roll: after, remnant } = cutRoll(roll, { ...input, lengthFt: "22" }, ids);
    expect(after.remainingLengthFt).toBe("41");
    expect(after.cuts).toEqual([{ id: "c1", at: input.at, lengthFt: "22", reference: "INV-1042", byUserId: "u1" }]);
    expect(remnant).toBeNull();
  });

  it("turns a leftover under 12 ft into a remnant and uses up the roll", () => {
    const { roll: after, remnant } = cutRoll(roll, { ...input, lengthFt: "55.5" }, ids);
    expect(after.remainingLengthFt).toBe("0");
    expect(remnant).toMatchObject({
      id: "r2",
      isRemnant: true,
      parentRollId: "r1",
      remainingLengthFt: "7.5",
      originalLengthFt: "7.5",
      dyeLot: "22B",
    });
  });

  it("keeps a leftover of exactly 12 ft on the roll", () => {
    expect(cutRoll(roll, { ...input, lengthFt: "51" }, ids).remnant).toBeNull();
  });

  it("only shortens a remnant, never makes a remnant of a remnant", () => {
    const { roll: after, remnant } = cutRoll(
      { ...roll, isRemnant: true, remainingLengthFt: "9" },
      { ...input, lengthFt: "4" },
      ids,
    );
    expect(after.remainingLengthFt).toBe("5");
    expect(remnant).toBeNull();
  });

  it("refuses zero, negative and longer-than-left cuts", () => {
    expect(validateCut(roll, "0")).toMatch(/greater than 0/);
    expect(validateCut(roll, "-3")).toMatch(/greater than 0/);
    expect(validateCut(roll, "64")).toBe("Only 63 ft is left on this roll.");
    expect(validateCut(roll, "twelve")).toMatch(/length in feet/);
    expect(() => cutRoll(roll, { ...input, lengthFt: "64" }, ids)).toThrow();
  });
});
