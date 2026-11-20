import { dec, type Room } from "@workspace/shared";

/**
 * A room's size as drawing numbers for the canvas's SVG units. A room keeps its width and length as
 * decimal strings in ft (CLAUDE.md rule 6; whole-product check F-k); only the drawing turns them
 * into numbers, and the canvas snaps to half a foot, so nothing it shows is rounded by a float.
 */
export function roomSize(room: Pick<Room, "widthFt" | "lengthFt">): { w: number; h: number } {
  return { w: dec(room.widthFt).toNumber(), h: dec(room.lengthFt).toNumber() };
}

/** A size drawn or typed in ft, snapped to half a foot, as the decimal string a room keeps. */
export function feetText(ft: number): string {
  return dec(ft).toDecimalPlaces(1).toString();
}
