import { create } from "qrcode";
import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE, qrDrawing } from "@/features/login/qr-matrix";

/** ADR 0060, section 1: the authenticator link drawn locally as one SVG path. */

const LINK =
  "otpauth://totp/Flooring%20Platform:dana.whitfield%40summitfloor.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Flooring%20Platform";

/** The dark cells the path draws, as "row,col" of the code (quiet zone removed). */
function drawnCells(path: string): Set<string> {
  const cells = new Set<string>();
  for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    cells.add(`${Number(match[2]) - QR_QUIET_ZONE},${Number(match[1]) - QR_QUIET_ZONE}`);
  }
  return cells;
}

describe("qrDrawing", () => {
  it("QR1 draws exactly the dark modules of the code, offset by a 4-module quiet zone", () => {
    const drawing = qrDrawing(LINK);
    const { modules } = create(LINK, { errorCorrectionLevel: "M" });
    expect(drawing.size).toBe(modules.size + 2 * QR_QUIET_ZONE);
    const expected = new Set<string>();
    for (let row = 0; row < modules.size; row += 1)
      for (let col = 0; col < modules.size; col += 1) if (modules.get(row, col)) expected.add(`${row},${col}`);
    expect(drawnCells(drawing.path)).toEqual(expected);
    expect(drawing.path.replace(/M\d+ \d+h1v1h-1z/g, "")).toBe("");
  });

  it("QR2 has the three finder patterns in its corners (a scanner's anchor)", () => {
    const { size, path } = qrDrawing(LINK);
    const cells = drawnCells(path);
    const n = size - 2 * QR_QUIET_ZONE;
    for (const [row, col] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      for (let i = 0; i < 7; i += 1) {
        expect(cells.has(`${row},${col + i}`)).toBe(true);
        expect(cells.has(`${row + 6},${col + i}`)).toBe(true);
      }
    }
  });

  it("QR3 is the same drawing for the same link, and a different one for another", () => {
    expect(qrDrawing(LINK)).toEqual(qrDrawing(LINK));
    expect(qrDrawing(LINK).path).not.toBe(qrDrawing(LINK.replace("JBSW", "KBSW")).path);
  });
});
