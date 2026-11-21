import { describe, expect, it } from "vitest";
import { dragModeAt, RESIZE_BAND_PX, resizeBandPx } from "@/features/meetings/drag-mode";
import { moveWords, UNDO_TOAST_MS } from "@/features/meetings/move-words";

// The week grid is 48 px an hour, so a 30-minute block is 24 px and an hour 48 px.
describe("move or resize from a press on a meeting block (click-through #44)", () => {
  it("moves from anywhere in a 30-minute block's body, the lower half included", () => {
    for (const offset of [0, 6, 12, 16, 17]) expect(dragModeAt(offset, 24)).toBe("move");
  });

  it("resizes only from the band at the bottom edge", () => {
    expect(resizeBandPx(24)).toBe(RESIZE_BAND_PX);
    expect(dragModeAt(18, 24)).toBe("resize");
    expect(dragModeAt(23.5, 24)).toBe("resize");
    expect(dragModeAt(41, 48)).toBe("move");
    expect(dragModeAt(42, 48)).toBe("resize");
  });

  it("keeps the band to a quarter of the shortest block", () => {
    expect(resizeBandPx(20)).toBe(5);
    expect(dragModeAt(14, 20)).toBe("move");
    expect(dragModeAt(15, 20)).toBe("resize");
  });
});

describe("words for a move and a resize", () => {
  it("names a resize as a change of length in the dialog and the toast", () => {
    const resize = moveWords("resize");
    expect(resize.dialogTitle).toBe("Change a repeating meeting's length");
    expect(resize.confirm).toBe("Change length");
    expect(resize.done("Weekly sales huddle", 90)).toBe("Weekly sales huddle now lasts 90 minutes");
    expect(resize.undone).toBe("Length change undone");
  });

  it("keeps a move's words", () => {
    const move = moveWords("move");
    expect(move.dialogTitle).toBe("Move a repeating meeting");
    expect(move.done("Weekly sales huddle", 30)).toBe("Weekly sales huddle moved");
    expect(move.undone).toBe("Move undone");
  });

  it("leaves Undo on screen long enough to use", () => {
    expect(UNDO_TOAST_MS).toBeGreaterThanOrEqual(8_000);
  });
});
