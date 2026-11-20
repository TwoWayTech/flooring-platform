import { create } from "qrcode";

/** The blank border every QR code needs around it to scan, in modules (ISO/IEC 18004). */
export const QR_QUIET_ZONE = 4;

/** A QR code drawn as one SVG path: `size` modules wide, quiet zone included. */
export interface QrDrawing {
  size: number;
  path: string;
}

/**
 * Encodes `text` as a QR code and returns its dark modules as one SVG path of unit squares, offset
 * by the quiet zone. Error correction M survives a scuffed screen without growing the code much.
 * Runs in the browser with no network, so the authenticator secret never leaves the page
 * (ADR 0060). Never log `text`: it holds the secret.
 */
export function qrDrawing(text: string): QrDrawing {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) parts.push(`M${col + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`);
    }
  }
  return { size: modules.size + 2 * QR_QUIET_ZONE, path: parts.join("") };
}
