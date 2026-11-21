/** How tall the resize band at a meeting block's bottom edge is, in pixels (click-through #44). */
export const RESIZE_BAND_PX = 6;

/**
 * The height of the resize band of a block this tall: `RESIZE_BAND_PX`, but never more than a quarter
 * of the block, so even the shortest block is mostly body and a drag from it moves the meeting.
 */
export function resizeBandPx(blockPx: number): number {
  return Math.min(RESIZE_BAND_PX, blockPx / 4);
}

/**
 * Whether a press on a meeting block starts a move or a resize (meetings.md "Move or resize": drag
 * moves, dragging the bottom edge resizes; click-through #44). `offsetPx` is how far below the
 * block's top the pointer went down. Only a press inside the bottom band resizes.
 */
export function dragModeAt(offsetPx: number, blockPx: number): "move" | "resize" {
  return offsetPx >= blockPx - resizeBandPx(blockPx) ? "resize" : "move";
}

/** Blocks shorter than this show their time and title on one line, so a 30-minute meeting keeps its title (#43). */
export const ONE_LINE_BELOW_PX = 40;
