import { describe, expect, it } from "vitest";
import { feetText, halfFoot, roomSize } from "@/features/quotes/room-geometry";

describe("room sizes on the canvas (F-k, rule 6)", () => {
  it("keeps sizes as decimal strings snapped to half a foot, and draws them as numbers", () => {
    expect(feetText(12)).toBe("12");
    expect(feetText(12.5)).toBe("12.5");
    expect(feetText(12.3)).toBe("12.5");
    expect(halfFoot("9.25")).toBe("9.5");
    expect(halfFoot("9.74")).toBe("9.5");
    expect(halfFoot("9.75")).toBe("10");
    expect(roomSize({ widthFt: "12.500", lengthFt: "10" })).toEqual({ w: 12.5, h: 10 });
  });
});
